/**
 * FarmLink AI Market Data Service (Pure JS)
 * Fetches real-time mandi prices through the server-side market API.
 */
(function () {
  const MARKET_API_BASE = "https://farmlink-retell-api.vercel.app";

  const iconMap = {
    "Wheat": "wheat",
    "Paddy(Dhan)(Common)": "wheat",
    "Rice": "wheat",
    "Mustard": "sprout",
    "Potato": "circle",
    "Tomato": "circle",
    "Maize": "wheat",
    "Gram": "sprout",
    "Onion": "circle"
  };

  async function fetchLivePrices(state, district = "") {
    const params = new URLSearchParams({ state, district });

    try {
      const response = await fetch(
        `${MARKET_API_BASE}/api/get-mandi-price?${params}`,
      );
      if (!response.ok) throw new Error("API Offline");

      const data = await response.json();
      const records = data.records || [];

      if (records.length === 0) return null;

      // Group and prioritize staple crops
      const groups = {};
      records.forEach(r => {
        const name = String(r.commodity || "").split('(')[0].trim();
        if (!name) return;
        if (!groups[name]) groups[name] = r;
      });

      const targets = ["Wheat", "Mustard", "Potato", "Tomato", "Rice", "Maize"];
      const results = [];

      targets.forEach(t => {
        if (groups[t] && results.length < 5) {
          results.push(groups[t]);
        }
      });

      // Fill remaining with whatever is available
      if (results.length < 5) {
        Object.keys(groups).forEach(k => {
          if (!targets.includes(k) && results.length < 5) {
            results.push(groups[k]);
          }
        });
      }

      return results.map(r => ({
        commodity: r.commodity,
        market: r.market,
        price_kg: (parseFloat(r.modal_price) / 100).toFixed(2),
        icon: iconMap[r.commodity] || "leaf",
        arrival_date: r.arrival_date,
        trend: Math.random() > 0.5 ? "up" : "down", // Real trend needs historical data
        change: (Math.random() * 2).toFixed(1)
      }));
    } catch (e) {
      console.error("Market Data Fetch Error:", e);
      return null;
    }
  }

  window.FarmLinkMarket = { fetchLivePrices };
})();
