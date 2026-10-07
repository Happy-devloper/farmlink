import requests

def get_coordinates(mandi, district, state):
    """
    Finds coordinates for a mandi using a robust fallback search.
    """
    search_queries = [
        f"{mandi}, {district}, {state}, India",
        f"{mandi}, {state}, India",
        f"{district}, {state}, India"
    ]

    url = "https://geocoding-api.open-meteo.com/v1/search"

    for query in search_queries:
        try:
            params = {"name": query, "count": 1, "language": "en", "format": "json"}
            response = requests.get(url, params=params, timeout=10)
            if response.status_code == 200:
                results = response.json().get('results', [])
                if results:
                    print(f"Weather discovery: Found coords for '{query}'")
                    return results[0]['latitude'], results[0]['longitude']
        except Exception as e:
            print(f"Geocoding error: {e}")

    return None, None

def get_weather_forecast(lat, lon):
    """
    Gets real-time 7-day forecast from Open-Meteo.
    """
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat, "longitude": lon,
        "daily": "precipitation_sum,temperature_2m_max",
        "timezone": "auto"
    }
    try:
        response = requests.get(url, params=params, timeout=10)
        if response.status_code == 200:
            return response.json().get('daily', {})
    except Exception as e:
        print(f"Weather fetch error: {e}")
    return {}

def get_historical_weather(lat, lon, start_date, end_date):
    """
    Fetches daily historical weather data for model training.
    dates should be in yyyy-mm-dd format.
    """
    print(f"  > Fetching Historical Weather ({start_date} to {end_date})...")
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": lat, "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "daily": "precipitation_sum,temperature_2m_max",
        "timezone": "auto"
    }
    try:
        response = requests.get(url, params=params, timeout=20)
        if response.status_code == 200:
            return response.json().get('daily', {})
    except Exception as e:
        print(f"Historical weather error: {e}")
    return {}

def analyze_weather_impact(weather_data, commodity):
    """
    Calculates small daily price adjustments based on rainfall.
    """
    if not weather_data:
        return [1.0] * 7, "Weather data unavailable."

    daily_impacts = []
    precip_list = weather_data.get('precipitation_sum', [])

    # Impact: Only rain > 5mm causes a small supply chain premium (+1-2%)
    for p in precip_list:
        if p > 15:
            daily_impacts.append(1.02) # +2% for heavy rain
        elif p > 5:
            daily_impacts.append(1.01) # +1% for moderate rain
        else:
            daily_impacts.append(1.0)

    # Padding
    while len(daily_impacts) < 7: daily_impacts.append(1.0)

    total_rain = sum(precip_list)
    if total_rain > 10:
        desc = f"Upcoming rain ({total_rain:.1f}mm) may cause slight transport delays."
    else:
        desc = "Stable weather expected. No significant price impact."

    return daily_impacts, desc
