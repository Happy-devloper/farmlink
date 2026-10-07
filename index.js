const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const RESOURCE_ID = "9ef84268-d588-465a-a308-a864a43d0070";
const DATA_GOV_URL = `https://api.data.gov.in/resource/${RESOURCE_ID}`;
const FALLBACK_CROPS = [
  { commodity: "Wheat", price: 2690, change: 0.4 },
  { commodity: "Mustard", price: 5850, change: 0.3 },
  { commodity: "Potato", price: 1850, change: -0.2 },
  { commodity: "Tomato", price: 3200, change: 0.7 },
  { commodity: "Maize", price: 2250, change: 0.25 },
  { commodity: "Rice", price: 3100, change: 0.35 },
  { commodity: "Gram", price: 6200, change: 0.25 },
  { commodity: "Onion", price: 2800, change: 0.5 },
];

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function input(req, name) {
  return String(req.body?.[name] ?? req.query[name] ?? "").trim();
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "FarmLink Retell API",
    endpoint: "/api/get-mandi-price",
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "FarmLink Retell API" });
});

async function fetchMarketRecords(filters, limit = 100) {
  const apiKey = process.env.DATA_GOV_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("DATA_GOV_API_KEY is not configured."), {
      status: 503,
    });
  }

  const params = new URLSearchParams({
    "api-key": apiKey,
    format: "json",
    limit: String(limit),
  });
  for (const [field, value] of Object.entries(filters)) {
    if (value) params.set(`filters[${field}]`, value);
  }

  const upstream = await fetch(`${DATA_GOV_URL}?${params}`);
  if (!upstream.ok) {
    throw Object.assign(new Error("Mandi data is temporarily unavailable."), {
      status: 502,
    });
  }
  const payload = await upstream.json();
  return payload.records || [];
}

function marketRecordValue(record, ...keys) {
  for (const key of keys) {
    if (
      record[key] !== undefined &&
      record[key] !== null &&
      record[key] !== ""
    ) {
      return record[key];
    }
  }
  return "";
}

function marketPrice(record) {
  const raw = marketRecordValue(record, "modal_price", "Modal_Price", "price");
  const price = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(price) && price > 0 ? price : null;
}

function marketDate(record) {
  return marketRecordValue(record, "arrival_date", "Arrival_Date", "date");
}

function marketFilters(req) {
  return {
    state: input(req, "state") || "Uttar Pradesh",
    district: input(req, "district"),
    market: input(req, "market") || input(req, "mandi"),
    commodity: input(req, "commodity"),
  };
}

function fallbackCrop(commodity) {
  const aliases = {
    गेहूं: "wheat",
    सरसों: "mustard",
    आलू: "potato",
    टमाटर: "tomato",
    मक्का: "maize",
    धान: "rice",
    चावल: "rice",
    "paddy(dhan)(common)": "rice",
  };
  const normalized = String(commodity || "Wheat")
    .trim()
    .toLowerCase();
  const key = aliases[normalized] || normalized;
  return FALLBACK_CROPS.find((crop) => crop.commodity.toLowerCase() === key);
}

function fallbackRecords(filters) {
  const crops = filters.commodity
    ? [fallbackCrop(filters.commodity)].filter(Boolean)
    : FALLBACK_CROPS;
  const today = new Date().toISOString().slice(0, 10);
  return crops.map((crop) => ({
    state: filters.state || "Uttar Pradesh",
    district: filters.district || "",
    market: filters.market || filters.district || "Regional estimate",
    commodity: crop.commodity,
    variety: "Indicative estimate",
    grade: "Not graded",
    min_price: String(Math.round(crop.price * 0.97)),
    max_price: String(Math.round(crop.price * 1.03)),
    modal_price: String(crop.price),
    arrival_date: today,
    source: "sample_estimate",
  }));
}

function fallbackMarketDetails(filters, days = 7) {
  const crop = fallbackCrop(filters.commodity);
  if (!crop) return null;

  const today = new Date();
  const history = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (13 - index));
    const price = crop.price * (1 + ((index - 13) * crop.change) / 3000);
    return {
      date: date.toISOString().slice(0, 10),
      price: Math.round(price * 100) / 100,
    };
  });
  const forecast = Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() + index + 1);
    const price = crop.price * (1 + (crop.change / 100) * ((index + 1) / 30));
    return {
      date: date.toISOString().slice(0, 10),
      predicted_price: Math.round(price * 100) / 100,
    };
  });

  return {
    commodity: crop.commodity,
    market: filters.market || filters.district || "Regional estimate",
    latest_price: crop.price,
    history,
    forecast,
    trend: crop.change > 0 ? "Upward" : crop.change < 0 ? "Downward" : "Stable",
    accuracy: "Indicative estimate",
    source: "sample_estimate",
    live_level: "Sample estimate, not live mandi data",
    advice: {
      recommendation: "Compare local offers",
      reasoning:
        "Live mandi data is unavailable. This indicative estimate is not a verified quote; confirm today's rate with the buyer or mandi.",
    },
    live_rates: [],
  };
}

async function getMajorCrops(req, res) {
  try {
    const filters = marketFilters(req);
    const records = await fetchMarketRecords(
      { state: filters.state, district: filters.district },
      100,
    );
    const latestByCrop = new Map();
    for (const record of records) {
      const commodity = marketRecordValue(record, "commodity", "Commodity");
      const price = marketPrice(record);
      if (commodity && price !== null && !latestByCrop.has(commodity)) {
        latestByCrop.set(commodity, {
          commodity,
          price,
          change: 0,
          trend: "stable",
        });
      }
    }
    if (latestByCrop.size > 0) {
      return res.json({
        ok: true,
        crops: [...latestByCrop.values()],
        source: "Agmarknet",
        message: "Latest mandi prices loaded.",
      });
    }
  } catch (error) {
    console.warn("Using fallback crop estimates:", error.message);
  }
  return res.json({
    ok: true,
    crops: FALLBACK_CROPS.map((crop) => ({
      ...crop,
      trend: crop.change > 0 ? "up" : crop.change < 0 ? "down" : "stable",
    })),
    source: "sample_estimate",
    message: "Live mandi data is unavailable; showing indicative estimates.",
  });
}

async function getMarketDetails(req, res) {
  try {
    const filters = marketFilters(req);
    const records = await fetchMarketRecords(filters, 100);
    const sortedRecords = records
      .filter((record) => marketPrice(record) !== null && marketDate(record))
      .sort(
        (left, right) =>
          Date.parse(marketDate(left)) - Date.parse(marketDate(right)),
      );
    if (sortedRecords.length === 0) {
      const details = fallbackMarketDetails(
        filters,
        Math.max(1, Math.min(Number(input(req, "days")) || 7, 30)),
      );
      if (!details) {
        return res.status(503).json({
          ok: false,
          message:
            "Live data is unavailable and no estimate is configured for this crop.",
        });
      }
      return res.json({
        ok: true,
        source: "sample_estimate",
        message:
          "Live mandi data is unavailable; showing an indicative estimate.",
        details,
      });
    }
    const history = sortedRecords.slice(-30).map((record) => ({
      date: marketDate(record),
      price: marketPrice(record),
    }));
    const latest = history.at(-1);
    const recent = history.slice(-7);
    const dailyChange =
      recent.length > 1
        ? (recent[recent.length - 1].price - recent[0].price) /
          (recent.length - 1)
        : 0;
    const days = Math.max(1, Math.min(Number(input(req, "days")) || 7, 30));
    const startDate = latest
      ? new Date(`${latest.date}T00:00:00Z`)
      : new Date();
    const forecast = latest
      ? Array.from({ length: days }, (_, index) => {
          const date = new Date(startDate);
          date.setUTCDate(date.getUTCDate() + index + 1);
          return {
            date: date.toISOString().slice(0, 10),
            predicted_price: Math.max(
              0,
              Math.round((latest.price + dailyChange * (index + 1)) * 100) /
                100,
            ),
          };
        })
      : [];
    const projectedPrice =
      forecast.at(-1)?.predicted_price || latest?.price || 0;
    const trend =
      projectedPrice > (latest?.price || 0) * 1.01
        ? "Upward"
        : projectedPrice < (latest?.price || 0) * 0.99
          ? "Downward"
          : "Stable";
    const latestRecord = sortedRecords.at(-1) || {};
    return res.json({
      ok: sortedRecords.length > 0,
      message: sortedRecords.length
        ? "Mandi records loaded."
        : "No mandi records found for these filters.",
      details: {
        commodity:
          filters.commodity ||
          marketRecordValue(latestRecord, "commodity", "Commodity"),
        market:
          filters.market ||
          marketRecordValue(latestRecord, "market", "Market") ||
          filters.district ||
          "Regional",
        latest_price: latest?.price || 0,
        history,
        forecast,
        trend,
        accuracy: "Trend baseline",
        advice: {
          recommendation:
            trend === "Upward"
              ? "Monitor for a better sale window"
              : "Compare current offers",
          reasoning:
            "Estimate uses recent mandi arrivals and prices; confirm the final rate with the buyer.",
        },
        live_rates: sortedRecords.slice(-10).reverse(),
      },
    });
  } catch (error) {
    console.warn("Using fallback mandi estimate:", error.message);
    const filters = marketFilters(req);
    const details = fallbackMarketDetails(
      filters,
      Math.max(1, Math.min(Number(input(req, "days")) || 7, 30)),
    );
    if (details) {
      return res.json({
        ok: true,
        source: "sample_estimate",
        message:
          "Live mandi data is unavailable; showing an indicative estimate.",
        details,
      });
    }
    return res.status(503).json({
      ok: false,
      message:
        error.message || "No live data or estimate is available for this crop.",
    });
  }
}

async function getNearbyColdStores(req, res) {
  const latitudeValue = input(req, "lat");
  const longitudeValue = input(req, "lon");
  const radiusValue = input(req, "radius");
  const latitude = Number(latitudeValue);
  const longitude = Number(longitudeValue);
  const radius = Number(radiusValue);
  if (
    !latitudeValue ||
    !longitudeValue ||
    !radiusValue ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(radius) ||
    radius < 5 ||
    radius > 100
  ) {
    return res.status(400).json({
      ok: false,
      message: "Valid coordinates and a 5–100 km search radius are required.",
    });
  }

  const radiusMeters = Math.round(radius * 1000);
  const query = `[out:json][timeout:12];(
    nwr["amenity"="cold_storage"](around:${radiusMeters},${latitude},${longitude});
    nwr["industrial"="cold_storage"](around:${radiusMeters},${latitude},${longitude});
    nwr["name"~"cold storage|cold store|cold room|cold warehouse|cold chain",i](around:${radiusMeters},${latitude},${longitude});
  );out center tags;`;
  const endpoint = new URL("https://overpass-api.de/api/interpreter");
  endpoint.searchParams.set("data", query);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "FarmLink/1.0 (nearby cold-storage search)",
      },
      signal: controller.signal,
    });
    if (!upstream.ok) {
      console.warn("Nearby cold-store data service returned:", upstream.status);
      return res.status(502).json({
        ok: false,
        message: "Nearby cold-store data is temporarily unavailable.",
      });
    }

    const payload = await upstream.json();
    const stores = (payload.elements || [])
      .map((element) => {
        const tags = element.tags || {};
        return {
          id: `${element.type}-${element.id}`,
          name: String(
            tags.name || tags.operator || tags["name:en"] || "Cold store",
          ).trim(),
          latitude: Number(element.lat ?? element.center?.lat),
          longitude: Number(element.lon ?? element.center?.lon),
          tags,
        };
      })
      .filter(
        (store) =>
          store.name &&
          Number.isFinite(store.latitude) &&
          Number.isFinite(store.longitude),
      );

    return res.json({
      ok: true,
      source: "OpenStreetMap",
      radius_km: radius,
      stores,
      total: stores.length,
    });
  } catch (error) {
    console.error("Nearby cold-store lookup failed:", error);
    return res.status(error.name === "AbortError" ? 504 : 502).json({
      ok: false,
      message:
        error.name === "AbortError"
          ? "Nearby cold-store lookup timed out. Try a smaller radius."
          : "Nearby cold-store data is temporarily unavailable.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function getMandiPrice(req, res) {
  const apiKey = process.env.DATA_GOV_API_KEY;
  if (!apiKey) {
    const records = fallbackRecords(marketFilters(req));
    return res.json({
      ok: records.length > 0,
      message: "Live mandi data is unavailable; showing indicative estimates.",
      source: "sample_estimate",
      records,
      total: records.length,
    });
  }

  const params = new URLSearchParams({
    "api-key": apiKey,
    format: "json",
    limit: "20",
  });
  for (const field of ["state", "district", "market", "commodity"]) {
    const value = input(req, field);
    if (value) params.set(`filters[${field}]`, value);
  }

  try {
    const upstream = await fetch(`${DATA_GOV_URL}?${params}`);
    if (!upstream.ok) {
      const records = fallbackRecords(marketFilters(req));
      return res.json({
        ok: records.length > 0,
        message:
          "Live mandi data is unavailable; showing indicative estimates.",
        source: "sample_estimate",
        records,
        total: records.length,
      });
    }

    const payload = await upstream.json();
    const records = (payload.records || []).map((record) => ({
      state: record.state || "",
      district: record.district || "",
      market: record.market || "",
      commodity: record.commodity || "",
      variety: record.variety || "",
      arrival_date: record.arrival_date || "",
      modal_price: record.modal_price || "",
      min_price: record.min_price || "",
      max_price: record.max_price || "",
    }));

    if (records.length > 0) {
      return res.json({
        ok: true,
        message: `Latest mandi prices found for ${input(req, "commodity") || "the requested crop"}.`,
        source: "Agmarknet",
        records,
        total: records.length,
      });
    }
    const estimates = fallbackRecords(marketFilters(req));
    return res.json({
      ok: estimates.length > 0,
      message: "No live mandi records found; showing indicative estimates.",
      source: "sample_estimate",
      records: estimates,
      total: estimates.length,
    });
  } catch (error) {
    console.warn("Using fallback mandi prices:", error.message);
    const records = fallbackRecords(marketFilters(req));
    return res.json({
      ok: records.length > 0,
      message: "Live mandi data is unavailable; showing indicative estimates.",
      source: "sample_estimate",
      records,
      total: records.length,
    });
  }
}

app.get("/api/get-mandi-price", getMandiPrice);
app.post("/api/get-mandi-price", getMandiPrice);
app.get("/api/cold-stores", getNearbyColdStores);
app.get("/api/market/major-crops", getMajorCrops);
app.get("/api/market/details", getMarketDetails);

module.exports = app;

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
