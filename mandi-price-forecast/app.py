import os

# CRITICAL: Prevent memory allocation issues on Windows
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"

import requests
import time
import json
from datetime import datetime
import pandas as pd
from flask import Flask, jsonify, request, send_from_directory, make_response
from flask_cors import CORS
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from concurrent.futures import ThreadPoolExecutor

from fetch_data import fetch_mandi_data, title_case
from clean_data import clean_mandi_data
from train import train_final_model
from predict import generate_forecast
from config import (
    API_KEY, RESOURCE_ID, STATE, DISTRICT, MANDI, COMMODITY,
    MODEL_PATH, RAW_DATA_PATH, get_data_paths
)

app = Flask(__name__)
CORS(app)

@app.before_request
def log_request_info():
    print(f"--> Incoming: {request.method} {request.url}")

executor = ThreadPoolExecutor(max_workers=4)

CACHE_TTL = 3600 * 24

# key: selection_hash -> "pending" | "ready" | "error"
training_registry = {}

def get_selection_hash(state, district, market, commodity):
    return f"{state}_{district}_{market}_{commodity}".lower().replace(" ", "_")

def get_session():
    session = requests.Session()
    session.headers.update({"User-Agent": "MandiAI-Prototype/7.0"})
    session.mount("https://", HTTPAdapter(max_retries=Retry(total=3, backoff_factor=1)))
    return session

session = get_session()

def is_model_cache_valid(model_path, data_path):
    if not os.path.exists(model_path) or not os.path.exists(data_path):
        return False
    return (time.time() - os.path.getmtime(model_path)) < CACHE_TTL

def fetch_live_mandi_rates(state, district, commodity):
    """Fetches real-time mandi prices across multiple search levels."""
    if not API_KEY:
        app.logger.warning(
            "DATA_GOV_API_KEY is not configured; live mandi data is unavailable."
        )
        return [], "Market Pulse"

    # Using the primary historical resource which is reliable for recent rates
    search_levels = [
        {"name": "Mandi Match", "filters": {"State": state, "District": district, "Commodity": commodity}},
        {"name": "Regional Match", "filters": {"State": state, "Commodity": commodity}},
        {"name": "India Match", "filters": {"Commodity": commodity}}
    ]

    for level in search_levels:
        try:
            params = {
                "api-key": API_KEY, "format": "json", "limit": "6",
                "sort[Arrival_Date]": "desc"
            }
            for k, v in level["filters"].items():
                if v: params[f"filters[{k}]"] = title_case(v)

            resp = session.get(f"https://api.data.gov.in/resource/{RESOURCE_ID}", params=params, timeout=10)
            if resp.ok:
                records = resp.json().get("records", [])
                if records:
                    return records, level["name"]
        except: pass

    return [], "Market Pulse"

@app.route('/')
def index():
    return send_from_directory(os.path.join(os.path.dirname(app.root_path), "public"), "index.html")

@app.route('/api/market/details', methods=['GET', 'POST', 'OPTIONS'])
def get_market_details():
    if request.method == 'OPTIONS':
        return make_response('', 204)

    if request.method == 'POST': data = request.json
    else: data = request.args

    state = data.get('state', STATE)
    district = data.get('district', DISTRICT)
    market = data.get('market', data.get('mandi', MANDI))
    commodity = data.get('commodity', COMMODITY)
    days = int(data.get('days', 30))

    paths = get_data_paths(state, district, market, commodity)
    h = get_selection_hash(state, district, market, commodity)
    source = "live_api"

    search_levels = [
        {"name": "Mandi Match", "st": state, "dt": district, "mk": market},
        {"name": "Regional Match", "st": state, "dt": None, "mk": None},
        {"name": "India Match", "st": None, "dt": None, "mk": None}
    ]

    final_success = False
    active_level = "None"
    variety_detected = "Standard"

    if is_model_cache_valid(paths["model"], paths["clean"]):
        # Check if cache is actually recent (not stale 2025 data)
        try:
            df_check = pd.read_csv(paths["clean"])
            if not df_check.empty:
                latest_date = pd.to_datetime(df_check.iloc[-1]['arrival_date'])
                days_old = (datetime.now() - latest_date).days
                if days_old < 30:
                    source = "saved_model"
                    final_success = True
                    active_level = "Historical Cache"
        except: pass

    if not final_success:
        # Heuristic: If specific market is stale, try "APMC" variation
        market_variants = [market]
        if "APMC" not in market.upper():
            market_variants.append(market + " APMC")
            market_variants.append(market + " Mandi")

        for m_variant in market_variants:
            for level in search_levels:
                curr_market = m_variant if level['mk'] else None
                success, msg = fetch_mandi_data(level['st'] or "", level['dt'] or "",
                                                curr_market or "", commodity,
                                                target_records=100, save_path=paths["raw"],
                                                fetch_weather=False)
                if success:
                    # Validate recency of fetched data
                    try:
                        df_raw = pd.read_csv(paths["raw"])
                        if not df_raw.empty:
                            raw_date_col = 'arrival_date' if 'arrival_date' in df_raw.columns else 'Arrival_Date'
                            latest_raw = pd.to_datetime(df_raw.iloc[0][raw_date_col], dayfirst=True, errors='coerce')
                            if pd.isna(latest_raw):
                                latest_raw = pd.to_datetime(df_raw.iloc[0][raw_date_col], errors='coerce')

                            days_old = (datetime.now() - latest_raw).days
                            if days_old < 45: # Relaxed slightly for mandi lag
                                final_success = True
                                active_level = level['name']
                                market = m_variant # Update to the working variant
                                break
                    except: pass

            if final_success: break

        if final_success:
            ok_clean, msg_clean, variety_detected = clean_mandi_data(state, district, market, commodity,
                                                                    raw_path=paths["raw"],
                                                                    clean_path=paths["clean"])
            train_final_model(model_path=paths["model"], clean_path=paths["clean"], search_level=active_level)
        else:
            # Final Fallback: District Level broad search (will likely be recent)
            success, msg = fetch_mandi_data(state, district, "", commodity, target_records=100,
                                            save_path=paths["raw"], fetch_weather=False)
            if success:
                final_success = True
                active_level = "District Avg"
                ok_clean, msg_clean, variety_detected = clean_mandi_data(state, district, market, commodity,
                                                                        raw_path=paths["raw"],
                                                                        clean_path=paths["clean"])
                train_final_model(model_path=paths["model"], clean_path=paths["clean"], search_level=active_level)
            else:
                return jsonify({"ok": False, "message": f"सरकारी Agmarknet पर {commodity} का कोई ताज़ा डेटा नहीं मिला।"}), 404

    results, msg = generate_forecast(days=days, state=state, district=district, mandi=market, commodity=commodity,
                                     model_path=paths["model"], clean_path=paths["clean"])

    if results is None:
        return jsonify({"ok": False, "message": "Forecasting failed."}), 500

    # Sync metadata
    try:
        meta_path = paths["model"].replace(".pkl", "_features.json")
        if os.path.exists(meta_path):
            with open(meta_path, 'r') as f:
                meta = json.load(f)
                if variety_detected == "Standard": variety_detected = meta.get("variety", "Standard")
                if active_level == "None" or active_level == "Historical Cache":
                    active_level = meta.get("level", "Saved Model")
    except: pass

    # Fetch live rates for the "Market Pulse" section
    live_rates, live_level = fetch_live_mandi_rates(state, district, commodity)

    return jsonify({
        "ok": True,
        "source": source,
        "level": active_level,
        "forecast_status": training_registry.get(h, "ready" if source=="saved_model" else "pending"),
        "details": {
            "commodity": commodity, "market": market,
            "variety": variety_detected,
            "latest_price": results["latest_actual_price"],
            "accuracy": results["meta"].get("mape", "--"),
            "trend": results["trend"],
            "advice": {
                "recommendation": "Sell" if results["trend"] == "Downward" else "Hold",
                "probability": 0.82,
                "reasoning": f"Prices are based on {active_level} from Agmarknet.",
                "signals": ["Historical Residuals", "Recent Volatility"]
            },
            "forecast": results["forecast"] if training_registry.get(h) == "ready" or source == "saved_model" else [],
            "history": results["history"][-15:],
            "weather": results["weather"],
            "live_rates": live_rates,
            "live_level": live_level
        }
    })

@app.route('/api/market/forecast-status')
def get_forecast_status():
    h = get_selection_hash(request.args.get('state', STATE), request.args.get('district', DISTRICT),
                           request.args.get('market', request.args.get('mandi', MANDI)),
                           request.args.get('commodity', COMMODITY))
    return jsonify({"ok": True, "status": training_registry.get(h, "unknown")})

@app.route('/api/market/major-crops')
def get_major_crops():
    state, district = request.args.get('state', STATE), request.args.get('district')
    major_commodities = ["Wheat", "Mustard", "Potato", "Tomato", "Rice", "Maize"]
    results = []
    def fetch_fast(comm):
        try:
            params = {"api-key": API_KEY, "format": "json", "limit": "2", "sort[Arrival_Date]": "desc", "filters[State]": title_case(state), "filters[Commodity]": title_case(comm)}
            if district: params["filters[District]"] = title_case(district)
            resp = session.get(f"https://api.data.gov.in/resource/{RESOURCE_ID}", params=params, timeout=10)
            if resp.ok:
                recs = resp.json().get("records", [])
                if recs:
                    latest = float(str(recs[0].get("Modal_Price", 0)).replace(",", ""))
                    prev = float(str(recs[1].get("Modal_Price", latest)).replace(",", "")) if len(recs) > 1 else latest
                    change_val = round(((latest - prev) / prev) * 100, 1) if prev > 0 else 0
                    return {"commodity": comm, "price": latest, "date": recs[0].get("Arrival_Date", "Today"), "change": abs(change_val), "trend": "up" if change_val > 0 else "down"}
        except: pass
        return None
    results = [r for r in executor.map(fetch_fast, major_commodities) if r]
    return jsonify({"ok": len(results) > 0, "crops": results})

@app.route('/api/proxy/ogd')
def proxy_ogd():
    target_url = request.args.get('url')
    if not target_url or 'api.data.gov.in' not in target_url: return jsonify({"ok": False}), 400
    try:
        resp = session.get(target_url, timeout=30)
        return jsonify(resp.json())
    except: return jsonify({"ok": False}), 500

@app.route('/api/config')
def get_config(): return jsonify({"state": STATE, "district": DISTRICT, "mandi": MANDI, "commodity": COMMODITY})

@app.route('/public/<path:path>')
def serve_public(path):
    return send_from_directory(os.path.join(os.path.dirname(app.root_path), "public"), path)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=5000, debug=os.getenv("FLASK_DEBUG", "0") == "1")
