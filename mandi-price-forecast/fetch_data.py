import os
import requests
import pandas as pd
import time
from datetime import datetime
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from config import API_KEY, RAW_DATA_PATH
from weather_api import get_coordinates, get_historical_weather

def title_case(value: str) -> str:
    if not value: return ""
    acronyms = {"APMC", "MSP", "FAQ"}
    words = value.strip().split()
    result = []
    for word in words:
        if word.upper() in acronyms:
            result.append(word.upper())
        else:
            result.append(word.capitalize())
    return " ".join(result)

def get_session():
    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    })
    session.mount("https://", HTTPAdapter(max_retries=Retry(
        total=5,
        backoff_factor=3,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET",),
    )))
    return session

def fetch_mandi_data(state, district, market, commodity, variety=None, target_records=2000, save_path=None, fetch_weather=True):
    """
    Fetches historical data with correct filtering and deep pagination.
    """
    print(f"\n[STEP 1: FETCHING] {commodity} in {market}, {district}, {state}...")
    api_key = API_KEY
    if not api_key:
        raise RuntimeError(
            "DATA_GOV_API_KEY is not configured. Set it in the server environment."
        )
    session = get_session()

    target_path = save_path if save_path else RAW_DATA_PATH

    start_time = time.time()

    # Resource 1: Historical (Used for trends and residuals)
    # Resource 2: Daily (Used for latest price validation)
    resources = [
        {"id": "35985678-0d79-46b4-9ed6-6f13308a1d24", "type": "historical"},
        {"id": "9ef84268-d588-465a-a308-a864a43d0070", "type": "daily"}
    ]

    all_records = []

    for res in resources:
        rid = res["id"]
        rtype = res["type"]
        print(f"  > Connecting to {rtype} resource: {rid}")

        # Resource specific keys
        if rtype == "historical":
            state_key, district_key, market_key = "filters[State]", "filters[District]", "filters[Market]"
            commodity_key, variety_key, sort_key = "filters[Commodity]", "filters[Variety]", "sort[Arrival_Date]"
        else:
            state_key, district_key, market_key = "filters[state]", "filters[district]", "filters[market]"
            commodity_key, variety_key, sort_key = "filters[commodity]", "filters[variety]", "sort[arrival_date]"

        offset, limit, fetched_for_resource = 0, 100, 0
        # For historical, we want as much as possible up to target
        max_to_fetch = target_records if rtype == "historical" else 100

        while fetched_for_resource < max_to_fetch:
            params = {
                "api-key": api_key, "format": "json", "limit": limit, "offset": offset,
                sort_key: "desc",
                state_key: title_case(state),
                district_key: title_case(district),
                market_key: title_case(market),
                commodity_key: title_case(commodity)
            }
            if variety: params[variety_key] = title_case(variety)

            try:
                # Mask API Key in logs for security
                masked_url = f"https://api.data.gov.in/resource/{rid}?api-key=HIDDEN&format=json&limit={limit}&offset={offset}"
                for k, v in params.items():
                    if k != 'api-key': masked_url += f"&{k}={v}"
                print(f"    [API CALL] {masked_url}")

                response = session.get(f"https://api.data.gov.in/resource/{rid}", params=params, timeout=30)
                if response.status_code == 200:
                    data = response.json()
                    records = data.get("records", [])
                    if not records: break

                    all_records.extend(records)
                    fetched_for_resource += len(records)
                    offset += limit

                    # Stop if we hit 2022 data (we want 2023 onwards)
                    last_date_str = records[-1].get("Arrival_Date") or records[-1].get("arrival_date")
                    if last_date_str:
                        try:
                            # Handle both formats dd/mm/yyyy and yyyy-mm-dd
                            if '/' in last_date_str:
                                last_year = int(last_date_str.split('/')[-1])
                            else:
                                last_year = int(last_date_str.split('-')[0])

                            if last_year < 2023:
                                print(f"    - Reached year {last_year}. Stopping fetch.")
                                break
                        except: pass

                    print(f"    - Success: {len(records)} records (Total: {fetched_for_resource})")
                    if len(records) < limit: break
                    time.sleep(0.2)
                else:
                    break
            except Exception as e:
                print(f"    - Connection Error: {e}")
                break

    duration = time.time() - start_time
    if all_records:
        df = pd.DataFrame(all_records)
        df.columns = [c.lower().replace(" ", "_") for c in df.columns]
        print(f"[FETCH COMPLETE] Total records found: {len(df)} | Time: {time.time() - start_time:.2f}s")
        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        df.to_csv(target_path, index=False)

        # FETCH HISTORICAL WEATHER
        if fetch_weather:
            try:
                # Get data date range
                df['date_dt'] = pd.to_datetime(df['arrival_date'], dayfirst=True, errors='coerce')
                valid_dates = df.dropna(subset=['date_dt'])
                if not valid_dates.empty:
                    start_d = valid_dates['date_dt'].min().strftime('%Y-%m-%d')
                    end_d = valid_dates['date_dt'].max().strftime('%Y-%m-%d')

                    lat, lon = get_coordinates(market, district, state)
                    if lat and lon:
                        weather_data = get_historical_weather(lat, lon, start_d, end_d)
                        if weather_data:
                            w_path = target_path.replace("raw_", "weather_")
                            pd.DataFrame(weather_data).to_csv(w_path, index=False)
                            print(f"  > Weather data saved to {w_path}")
            except Exception as we:
                print(f"  > Weather fetch failed (skipping): {we}")

        return True, f"Success: {len(df)} records fetched."

    print(f"[FETCH FAILED] No records returned from API. KEEPING EXISTING CACHE.")
    return False, "No data found for this selection."

if __name__ == "__main__":
    from config import STATE, DISTRICT, MANDI, COMMODITY
    # Default test case: Lucknow -> Malihabad -> Rice (Actually often Paddy)
    success, msg = fetch_mandi_data("Uttar Pradesh", "Lucknow", "Malihabad", "Rice")
    print(msg)
