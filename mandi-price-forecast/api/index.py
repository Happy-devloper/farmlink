import os
import csv
from datetime import date, datetime, timedelta
from pathlib import Path

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DATA_GOV_URL = "https://api.data.gov.in/resource"
RESOURCE_ID = os.getenv("DATA_GOV_RESOURCE_ID", "35985678-0d79-46b4-9ed6-6f13308a1d24")
API_KEY = os.getenv("DATA_GOV_API_KEY", "")
CACHE_DIR = Path(__file__).resolve().parent.parent / "data"


def fetch_records(filters, limit=50):
    if not API_KEY:
        return None, "DATA_GOV_API_KEY is not configured on Vercel."
    params = {"api-key": API_KEY, "format": "json", "limit": limit}
    for key, value in filters.items():
        if value:
            params[f"filters[{key}]"] = str(value).strip().title()
    try:
        response = requests.get(f"{DATA_GOV_URL}/{RESOURCE_ID}", params=params, timeout=6)
        response.raise_for_status()
        return response.json().get("records", []), None
    except requests.RequestException:
        return None, "Live mandi service is temporarily unavailable."


def cached_records(commodity=""):
    records = []
    files = list(CACHE_DIR.glob("clean_*.csv"))
    for path in files:
        if commodity and commodity.lower() not in path.name.lower():
            continue
        try:
            with path.open(encoding="utf-8-sig", newline="") as stream:
                records.extend(csv.DictReader(stream))
        except (OSError, csv.Error):
            continue
    return records


def numeric_price(record):
    value = record.get("modal_price") or record.get("Modal_Price") or record.get("price")
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def forecast_from_records(records, days):
    points = []
    for record in records:
        raw_date = record.get("arrival_date") or record.get("Arrival_Date") or record.get("date")
        price = numeric_price(record)
        try:
            parsed_date = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00")).date()
        except (TypeError, ValueError):
            continue
        if price is not None and price > 0:
            points.append((parsed_date, price))
    points.sort(key=lambda item: item[0])
    if not points:
        return {"latest_price": 0, "history": [], "forecast": [], "trend": "Unavailable", "accuracy": "--"}

    recent = points[-30:]
    base_date = recent[0][0]
    xs = [(item[0] - base_date).days for item in recent]
    ys = [item[1] for item in recent]
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    denominator = sum((x - mean_x) ** 2 for x in xs)
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denominator if denominator else 0
    slope = max(-abs(mean_y) * 0.02, min(abs(mean_y) * 0.02, slope))
    latest_date, latest_price = points[-1]
    forecast = []
    for offset in range(1, max(1, int(days)) + 1):
        predicted = max(0.01, latest_price + slope * offset)
        forecast.append({"date": (latest_date + timedelta(days=offset)).isoformat(), "predicted_price": round(predicted, 2)})
    change = (forecast[-1]["predicted_price"] - latest_price) / latest_price if latest_price else 0
    trend = "Upward" if change > 0.015 else "Downward" if change < -0.015 else "Stable"
    return {
        "latest_price": round(latest_price, 2),
        "history": [{"date": item_date.isoformat(), "price": round(price, 2)} for item_date, price in points[-30:]],
        "forecast": forecast,
        "trend": trend,
        "accuracy": "Trend model",
    }


def fetch_with_fallback(filters, limit=100):
    records, error = fetch_records(filters, limit)
    if records is not None:
        return records, None
    broad_filters = {
        key: value
        for key, value in filters.items()
        if key not in {"Market", "Commodity"}
    }
    broad_records, broad_error = fetch_records(broad_filters, limit)
    return broad_records, broad_error or error


@app.get("/")
def root():
    return jsonify({"ok": True, "service": "FarmLink Mandi Forecast API"})


@app.get("/api/config")
def config():
    return jsonify({"state": "Uttar Pradesh", "district": "Lucknow", "mandi": "Lucknow", "commodity": "Wheat"})


@app.get("/api/market/major-crops")
def major_crops():
    records, error = fetch_records({"State": request.args.get("state", "Uttar Pradesh"), "District": request.args.get("district", "")})
    if error:
        records = cached_records()
        if not records:
            return jsonify({"ok": False, "message": error, "crops": []})
    grouped = {}
    for record in records or []:
        commodity = record.get("Commodity") or record.get("commodity")
        if not commodity or commodity in grouped:
            continue
        raw_price = str(record.get("Modal_Price") or record.get("modal_price") or "0").replace(",", "")
        try:
            price = float(raw_price)
        except ValueError:
            price = 0
        grouped[commodity] = {"commodity": commodity, "price": price, "date": record.get("Arrival_Date") or record.get("arrival_date") or "Today"}
    return jsonify({"ok": True, "crops": list(grouped.values()), "source": "live" if not error else "cached"})


@app.get("/api/market/details")
def market_details():
    records, error = fetch_with_fallback({
        "State": request.args.get("state", "Uttar Pradesh"),
        "District": request.args.get("district", ""),
        "Market": request.args.get("market", request.args.get("mandi", "")),
        "Commodity": request.args.get("commodity", ""),
    }, 100)
    commodity = request.args.get("commodity", "")
    records = records or cached_records(commodity)
    forecast = forecast_from_records(records, request.args.get("days", 30))
    return jsonify({
        "ok": bool(records),
        "message": ("Live mandi records found." if not error else "Showing cached mandi data." if records else error),
        "details": {
            "commodity": commodity,
            "market": request.args.get("market", request.args.get("mandi", "Regional")),
            "live_rates": records or [],
            "forecast": forecast["forecast"],
            "history": forecast["history"],
            "latest_price": forecast["latest_price"],
            "trend": forecast["trend"],
            "accuracy": forecast["accuracy"],
            "advice": {
                "recommendation": "Hold" if forecast["trend"] == "Stable" else "Monitor",
                "reasoning": "Forecast based on the latest available mandi price history and recent price trend.",
            },
        },
    })


handler = app
