/**
 * FarmLink Pure JavaScript Market Rates Service
 * Fetches real-time mandi prices using the local Python proxy for reliability.
 */
(function () {
  const MARKET_API_BASE = "https://farmlink-retell-api.vercel.app";
  const FALLBACK_MARKET_DATA = {
    Wheat: { price: 2690, change: 0.4, date: "आज", market: "क्षेत्रीय अनुमान" },
    Mustard: {
      price: 5850,
      change: 0.3,
      date: "आज",
      market: "क्षेत्रीय अनुमान",
    },
    Potato: {
      price: 1850,
      change: -0.2,
      date: "आज",
      market: "क्षेत्रीय अनुमान",
    },
    Tomato: {
      price: 3200,
      change: 0.7,
      date: "आज",
      market: "क्षेत्रीय अनुमान",
    },
    Maize: {
      price: 2250,
      change: 0.25,
      date: "आज",
      market: "क्षेत्रीय अनुमान",
    },
    Rice: { price: 3100, change: 0.35, date: "आज", market: "क्षेत्रीय अनुमान" },
    Gram: { price: 6200, change: 0.25, date: "आज", market: "क्षेत्रीय अनुमान" },
    Onion: { price: 2800, change: 0.5, date: "आज", market: "क्षेत्रीय अनुमान" },
  };

  function groupCrops(crops, source = "Agmarknet") {
    return (crops || []).reduce((groups, crop) => {
      const commodity = String(crop.commodity || crop.Commodity || "").trim();
      if (!commodity) return groups;
      const key =
        commodity.charAt(0).toUpperCase() + commodity.slice(1).toLowerCase();
      const price = Number(
        crop.price || crop.Modal_Price || crop.modal_price || 0,
      );
      const change = Number(crop.change || crop.Change || 0);
      groups[key] = [
        {
          Commodity: commodity,
          Market: crop.market || crop.Market || "Regional mandi",
          Arrival_Date: crop.date || crop.Arrival_Date || "Today",
          Modal_Price: price,
          Forecast_Price:
            Number(crop.predicted_price || crop.Forecast_Price) ||
            Math.round(price * (1 + (change / 100) * (7 / 30))),
          Trend:
            crop.trend || (change > 0 ? "up" : change < 0 ? "down" : "stable"),
          Change: change,
          Source: crop.source || source,
        },
      ];
      return groups;
    }, {});
  }

  function getFallbackMandiRates() {
    return groupCrops(
      Object.entries(FALLBACK_MARKET_DATA).map(([commodity, value]) => ({
        commodity,
        ...value,
      })),
      "sample_estimate",
    );
  }

  async function requestJson(url) {
    const response = await fetch(url);
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) return null;
    return response.json();
  }

  async function fetchLiveMandiRates(state, district = "") {
    console.log(`[MarketJS] Syncing market data for ${state}, ${district}...`);

    const params = new URLSearchParams({ state, district });
    try {
      const payload = await requestJson(
        `${MARKET_API_BASE}/api/market/major-crops?${params}`,
      );
      if (payload?.ok && payload.crops?.length)
        return groupCrops(payload.crops, payload.source);
      const details = await requestJson(
        `${MARKET_API_BASE}/api/market/details?${new URLSearchParams({ state, district, commodity: "Wheat", days: "7" })}`,
      );
      if (details?.ok && details.details?.live_rates?.length)
        return groupCrops(details.details.live_rates);
    } catch (error) {
      console.warn("[MarketJS] Remote market API unavailable:", error.message);
    }
    return getFallbackMandiRates();
  }

  window.FarmLinkMarket = {
    fetchLiveMandiRates,
    getFallbackMandiRates,
    iconMap: {
      Wheat: "wheat",
      Rice: "wheat",
      Paddy: "wheat",
      Maize: "wheat",
      Gram: "sprout",
      Mustard: "sprout",
      Potato: "circle",
      Tomato: "circle",
      Onion: "circle",
    },
  };
})();
