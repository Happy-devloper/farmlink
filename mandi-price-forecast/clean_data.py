import pandas as pd
import numpy as np
import os
from config import RAW_DATA_PATH, CLEAN_DATA_PATH

def clean_mandi_data(state, district, market, commodity, raw_path=None, clean_path=None):
    """
    Cleans raw data, normalizes prices, and prepares for residual modeling.
    """
    target_raw = raw_path if raw_path else RAW_DATA_PATH
    target_clean = clean_path if clean_path else CLEAN_DATA_PATH

    print(f"\n[STEP 2: CLEANING] {commodity} in {market}...")
    if not os.path.exists(target_raw):
        print(f"  ! Error: Raw data file missing at {target_raw}")
        return False, "Raw data file not found.", None

    df = pd.read_csv(target_raw)
    initial_raw_count = len(df)

    # 1. Normalize Columns
    df.columns = [c.lower().replace(" ", "_") for c in df.columns]

    # 2. Clean Prices (Handle commas, strings, and invalid values)
    def to_numeric_price(val):
        try:
            if pd.isna(val): return np.nan
            clean_val = str(val).replace("₹", "").replace(",", "").strip()
            return float(clean_val)
        except:
            return np.nan

    df['modal_price'] = df['modal_price'].apply(to_numeric_price)
    df = df.dropna(subset=['modal_price'])
    df = df[df['modal_price'] > 10] # Filter out suspiciously low prices

    # 3. Date Formatting & Sorting
    df['arrival_date'] = pd.to_datetime(df['arrival_date'], dayfirst=True, errors='coerce')
    df = df.dropna(subset=['arrival_date'])
    df = df.sort_values(by='arrival_date').reset_index(drop=True)

    # 4. Strict Filtering
    df = df[
        (df['state'].str.lower() == state.lower()) &
        (df['commodity'].str.lower() == commodity.lower())
    ].reset_index(drop=True)

    if len(df) == 0:
        print("  ! Error: No records matching filter.")
        return False, f"No records found for {commodity} in {state}.", None

    # 5. Smart Variety Detection
    # Identify the variety with the most records to focus on a "normal" single trend
    if 'variety' in df.columns:
        variety_counts = df['variety'].value_counts()
        if not variety_counts.empty:
            main_variety = variety_counts.index[0]
            print(f"  > Detected main variety: {main_variety} ({variety_counts[main_variety]} records)")
            df = df[df['variety'] == main_variety].reset_index(drop=True)
        else:
            main_variety = "Standard"
    else:
        main_variety = "Standard"

    # 6. Deduplication
    initial_count = len(df)
    id_cols = ['arrival_date', 'market', 'commodity', 'variety', 'grade']
    available_cols = [c for c in id_cols if c in df.columns]
    df = df.drop_duplicates(subset=available_cols).reset_index(drop=True)

    # 7. Aggregation (One price point per day)
    df_clean = df.groupby('arrival_date').agg({
        'state': 'first',
        'district': 'first',
        'market': 'first',
        'commodity': 'first',
        'modal_price': 'mean'
    }).reset_index()

    df_clean = df_clean.sort_values(by='arrival_date').reset_index(drop=True)

    # 8. Weather Integration
    w_path = target_raw.replace("raw_", "weather_")
    if os.path.exists(w_path):
        try:
            w_df = pd.read_csv(w_path)
            w_df['time'] = pd.to_datetime(w_df['time'])

            # Merge on date
            df_clean = pd.merge(df_clean, w_df, left_on='arrival_date', right_on='time', how='left')
            df_clean = df_clean.drop(columns=['time'])

            # Fill missing weather (if any)
            df_clean['precipitation_sum'] = df_clean['precipitation_sum'].fillna(0)
            df_clean['temperature_2m_max'] = df_clean['temperature_2m_max'].interpolate().fillna(method='bfill').fillna(25)
            print(f"  > Successfully merged weather data.")
        except Exception as we:
            print(f"  > Warning: Weather merge failed: {we}")

    # 9. Quality Check & Logging
    if len(df_clean) > 0:
        latest_price = df_clean.iloc[-1]['modal_price']
        latest_date = df_clean.iloc[-1]['arrival_date'].strftime('%Y-%m-%d')

        print(f"[CLEAN COMPLETE] Statistics:")
        print(f"  > Input records: {initial_raw_count}")
        print(f"  > Unique days: {len(df_clean)}")
        print(f"  > Date range: {df_clean['arrival_date'].min().date()} to {latest_date}")
        print(f"  > ANCHOR PRICE: ₹{latest_price}/quintal")

        os.makedirs(os.path.dirname(target_clean), exist_ok=True)
        df_clean.to_csv(target_clean, index=False)
        return True, "Success", main_variety

    print("  ! Error: Cleaning resulted in zero records.")
    return False, "Cleaning resulted in zero records.", None

if __name__ == "__main__":
    from config import STATE, DISTRICT, MANDI, COMMODITY
    success, msg, var = clean_mandi_data("Uttar Pradesh", "Lucknow", "Malihabad", "Rice")
    print(msg)
