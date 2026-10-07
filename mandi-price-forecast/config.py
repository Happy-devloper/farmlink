import os

# Base directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# API Settings (Switching to the main Historical Resource ID)
API_KEY = os.getenv("DATA_GOV_API_KEY", "").strip()
RESOURCE_ID = "35985678-0d79-46b4-9ed6-6f13308a1d24"

# Default Filters
STATE = "Uttar Pradesh"
DISTRICT = "Lucknow"
MANDI = "Lucknow"
COMMODITY = "Wheat"

# File Paths
RAW_DATA_PATH = os.path.join(BASE_DIR, "data", "raw_market_data.csv")
CLEAN_DATA_PATH = os.path.join(BASE_DIR, "data", "clean_market_data.csv")
MODEL_PATH = os.path.join(BASE_DIR, "model", "model.pkl")

def get_data_paths(state, district, market, commodity):
    tag = f"{state}_{district}_{market}_{commodity}".lower().replace(" ", "_")
    return {
        "raw": os.path.join(BASE_DIR, "data", f"raw_{tag}.csv"),
        "clean": os.path.join(BASE_DIR, "data", f"clean_{tag}.csv"),
        "model": os.path.join(BASE_DIR, "model", f"model_{tag}.pkl")
    }
