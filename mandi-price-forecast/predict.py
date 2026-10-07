import pandas as pd
import numpy as np
import joblib
import os
import json
import requests
from datetime import datetime, timedelta
from config import CLEAN_DATA_PATH, MODEL_PATH
from weather_api import get_coordinates, get_weather_forecast, analyze_weather_impact

def generate_forecast(days=30, state=None, district=None, mandi=None, commodity=None, model_path=None, clean_path=None):
    """
    Generates a forecast anchored to the latest real mandi price.
    """
    target_model_path = model_path if model_path else MODEL_PATH
    target_clean = clean_path if clean_path else CLEAN_DATA_PATH

    print(f"\n[STEP 4: PREDICTING] {commodity} for {days} days...")

    if not os.path.exists(target_model_path) or not os.path.exists(target_clean):
        print(f"  ! Error: Model or Clean data missing. Model: {os.path.exists(target_model_path)}, Data: {os.path.exists(target_clean)}")
        return None, "Model or data missing."

    # 1. Load Model and Latest Data
    model_data = joblib.load(target_model_path)
    std_volatility = model_data.get("volatility", 0.02)

    df = pd.read_csv(target_clean)
    df['arrival_date'] = pd.to_datetime(df['arrival_date'])
    df = df.sort_values('arrival_date').reset_index(drop=True)

    latest_actual_price = float(df.iloc[-1]['modal_price'])
    latest_date = df.iloc[-1]['arrival_date']

    # Hot Fix: If data is older than 7 days, check for a "Today" price anchor
    days_stale = (datetime.now() - latest_date).days
    if days_stale > 7:
        print(f"  ! Data is {days_stale} days old. Attempting fresh anchor...")
        try:
            # Try to get today's price from OGD Daily API directly
            daily_url = "https://api.data.gov.in/resource/9ef84268-d588-465a-a308-a864a43d0070"
            from config import API_KEY
            from fetch_data import title_case
            params = {
                "api-key": API_KEY, "format": "json", "limit": 1, "sort[arrival_date]": "desc",
                "filters[state]": title_case(state), "filters[commodity]": title_case(commodity)
            }
            if district: params["filters[district]"] = title_case(district)

            resp = requests.get(daily_url, params=params, timeout=5)
            if resp.ok:
                recs = resp.json().get("records", [])
                if recs:
                    price_val = float(str(recs[0].get("modal_price", 0)).replace(",", ""))
                    date_val = pd.to_datetime(recs[0].get("arrival_date"))
                    if not pd.isna(date_val) and (datetime.now() - date_val).days < 7:
                        latest_actual_price = price_val
                        latest_date = date_val
                        print(f"  ✓ Found fresh anchor: ₹{latest_actual_price} on {latest_date.date()}")
        except Exception as e:
            print(f"  ! Anchor fetch failed: {e}")

    print(f"  > ANCHOR POINT: ₹{latest_actual_price} on {latest_date.date()}")

    # 2. Weather
    weather_impacts = [1.0] * days
    weather_desc = "Weather data unavailable."
    w_raw = None
    if state and district and mandi:
        try:
            lat, lon = get_coordinates(mandi, district, state)
            if lat and lon:
                w_raw = get_weather_forecast(lat, lon)
                impacts, desc = analyze_weather_impact(w_raw, commodity)
                weather_desc = desc
                for i in range(min(len(impacts), days)):
                    # Increased impact weight from 0.15 to 0.4 for more visible trend influence
                    weather_impacts[i] = 1.0 + (impacts[i] - 1.0) * 0.4
        except: pass

    # 3. Forecast Logic
    forecast_results = []
    current_df = df.copy()
    current_price = latest_actual_price

    is_baseline = model_data.get("is_baseline", False)
    if not is_baseline:
        model = model_data["model"]
        feature_cols = model_data["feature_cols"]

    for i in range(1, days + 1):
        next_date = latest_date + timedelta(days=i)
        feat_row = {}

        # Pre-populate weather features for the current forecast day
        if w_raw and 'precipitation_sum' in w_raw and (i-1) < len(w_raw['precipitation_sum']):
            feat_row['current_rain'] = w_raw['precipitation_sum'][i-1]
        else:
            feat_row['current_rain'] = 0

        if w_raw and 'temperature_2m_max' in w_raw and (i-1) < len(w_raw['temperature_2m_max']):
            feat_row['current_temp'] = w_raw['temperature_2m_max'][i-1]
        else:
            feat_row['current_temp'] = 25

        if is_baseline:
            # Baseline: Mean drift + noise
            change = model_data.get("mean_change", 0) + (np.random.normal(0, std_volatility * 0.3))
        else:
            lags = [1, 2, 3, 7]
            for lag in lags:
                feat_row[f'lag_price_{lag}'] = current_df.iloc[-lag]['modal_price'] if len(current_df) >= lag else latest_actual_price
                try:
                    prev_p = current_df.iloc[-lag-1]['modal_price']
                    feat_row[f'lag_change_{lag}'] = current_df.iloc[-lag]['modal_price'] / prev_p - 1 if prev_p > 0 else 0
                except: feat_row[f'lag_change_{lag}'] = 0

                # Include weather lags if model expects them
                if f'lag_rain_{lag}' in feature_cols:
                    feat_row[f'lag_rain_{lag}'] = current_df.iloc[-lag].get('precipitation_sum', 0)
                if f'lag_temp_{lag}' in feature_cols:
                    feat_row[f'lag_temp_{lag}'] = current_df.iloc[-lag].get('temperature_2m_max', 25)

            windows = [7, 30]
            for w in windows:
                feat_row[f'rolling_mean_{w}'] = current_df['modal_price'].tail(w).mean()
                feat_row[f'rolling_std_{w}'] = current_df['modal_price'].tail(w).std() if len(current_df) >= w else 0
                if f'rolling_rain_{w}' in feature_cols:
                    feat_row[f'rolling_rain_{w}'] = current_df['precipitation_sum'].tail(w).sum() if 'precipitation_sum' in current_df.columns else 0

            feat_row['day_of_week'] = next_date.dayofweek
            feat_row['month'] = next_date.month

            # Note: current_rain/temp are already in feat_row

            X = pd.DataFrame([feat_row])[feature_cols]
            change = model.predict(X)[0]

        # Clamping
        clamped_change = max(-3 * std_volatility, min(3 * std_volatility, change))
        next_price = current_price * (1 + clamped_change)

        # Apply additional supply chain multiplier if not already captured by the model
        if i <= 7:
            next_price *= weather_impacts[i-1]

        next_price = round(next_price, 2)

        forecast_results.append({'date': next_date.strftime('%Y-%m-%d'), 'predicted_price': float(next_price)})

        # Update for iteration
        new_row = current_df.iloc[-1].copy()
        new_row['arrival_date'] = next_date
        new_row['modal_price'] = next_price
        if 'precipitation_sum' in current_df.columns:
            new_row['precipitation_sum'] = feat_row.get('current_rain', 0)
        if 'temperature_2m_max' in current_df.columns:
            new_row['temperature_2m_max'] = feat_row.get('current_temp', 25)

        current_df = pd.concat([current_df, pd.DataFrame([new_row])], ignore_index=True)
        current_price = next_price

    # 4. Meta
    meta_path = target_model_path.replace(".pkl", "_features.json")
    with open(meta_path, "r") as f: meta = json.load(f)

    total_diff = (current_price - latest_actual_price) / latest_actual_price
    trend = "Upward" if total_diff > 0.015 else ("Downward" if total_diff < -0.015 else "Stable")

    print(f"[PREDICT COMPLETE]")
    print(f"  > Day 1: ₹{forecast_results[0]['predicted_price']}")
    print(f"  > Day {days}: ₹{forecast_results[-1]['predicted_price']}")

    return {
        "forecast": forecast_results, "trend": trend, "latest_actual_price": latest_actual_price,
        "meta": meta, "weather": {"description": weather_desc},
        "history": df.apply(lambda x: {"date": x['arrival_date'].strftime('%Y-%m-%d'), "price": float(x['modal_price'])}, axis=1).tolist()
    }, "Success"

if __name__ == "__main__":
    res, msg = generate_forecast()
