/* Open-Meteo integration: no API key required. Location is resolved from the
 * saved Post Office + district, then forecast data is shown on the dashboard. */
(function () {
  const DEFAULT_WEATHER_POINT = {
    latitude: 26.951818707714093,
    longitude: 81.09817510185222,
    name: "Bara Banki, Uttar Pradesh",
  };
  const STATE_WEATHER_POINTS = {
    Bihar: { latitude: 25.5941, longitude: 85.1376, name: "Bihar" },
    "Uttar Pradesh": DEFAULT_WEATHER_POINT,
    Maharashtra: { latitude: 19.076, longitude: 72.8777, name: "Maharashtra" },
  };
  const codeIcon = (code) => {
    if ([95, 96, 99].includes(code)) return "⛈️";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code))
      return "🌧️";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "🌨️";
    if ([1, 2, 3, 45, 48].includes(code)) return "🌤️";
    return "☀️";
  };
  const label = (code) =>
    ({
      0: "साफ मौसम",
      1: "मुख्यतः साफ",
      2: "आंशिक बादल",
      3: "बादल छाए",
      45: "धुंध",
      48: "कोहरा",
      51: "हल्की फुहार",
      53: "फुहार",
      55: "तेज़ फुहार",
      61: "हल्की बारिश",
      63: "बारिश",
      65: "तेज़ बारिश",
      80: "बौछार",
      81: "बौछार",
      82: "तेज़ बौछार",
      95: "आंधी/तूफान",
    })[code] || "मौसम अपडेट";
  const dayName = (date) =>
    new Intl.DateTimeFormat("hi-IN", { weekday: "short" }).format(
      new Date(`${date}T12:00:00`),
    );
  const loadingBlock = (width) =>
    `<span style="display:inline-block;width:${width};height:12px;border-radius:7px;background:linear-gradient(90deg,rgba(255,255,255,.18),rgba(255,255,255,.48),rgba(255,255,255,.18));background-size:220% 100%;animation:farmlinkWeatherShimmer 1.1s infinite"></span>`;
  function showLoading() {
    const now = document.querySelector(".weather-now");
    if (now)
      now.innerHTML = `<span>◌</span><div>${loadingBlock("46px")}<small>${loadingBlock("70px")}<br>${loadingBlock("58px")}</small></div>`;
    document.querySelectorAll(".weather-day").forEach((node) => {
      node.innerHTML = `${loadingBlock("26px")}<b>◌</b>${loadingBlock("44px")}`;
    });
    const panel = document.querySelector(".weather-panel");
    if (panel)
      panel.innerHTML = `<div class="weather-big">◌</div><div>${loadingBlock("64px")}<small style="display:block;margin-top:7px">${loadingBlock("170px")}</small></div>`;
    const list = document.querySelector(".weather-list");
    if (list)
      list.innerHTML = Array.from(
        { length: 3 },
        () =>
          `<div>${loadingBlock("36px")}${loadingBlock("20px")}${loadingBlock("54px")}</div>`,
      ).join("");
  }
  async function coordinates(place) {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", place);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "hi");
    url.searchParams.set("format", "json");
    const response = await fetch(url);
    if (!response.ok) throw new Error("स्थान खोज उपलब्ध नहीं है");
    const result = await response.json(),
      location = result.results?.[0];
    if (!location) throw new Error("मौसम के लिए location नहीं मिला");
    return location;
  }
  function update(current, daily) {
    const now = document.querySelector(".weather-now"),
      description = label(current.weather_code);
    if (now)
      now.innerHTML = `<span>${codeIcon(current.weather_code)}</span><div><strong>${Math.round(current.temperature_2m)}°C</strong><small>${description}<br>हवा: ${Math.round(current.wind_speed_10m || 0)} km/h</small></div>`;
    document.querySelectorAll(".weather-day").forEach((node, index) => {
      if (daily.time[index])
        node.innerHTML = `<span>${index === 0 ? "आज" : dayName(daily.time[index])}</span><b>${codeIcon(daily.weather_code[index])}</b><small>${Math.round(daily.temperature_2m_max[index])}° / ${Math.round(daily.temperature_2m_min[index])}°</small>`;
    });
    const panel = document.querySelector(".weather-panel");
    if (panel)
      panel.innerHTML = `<div class="weather-big">${codeIcon(current.weather_code)}</div><div><div class="weather-temperature">${Math.round(current.temperature_2m)}°C</div><small>${description} · हवा ${Math.round(current.wind_speed_10m || 0)} km/h · नमी ${current.relative_humidity_2m || 0}%</small></div>`;
    const list = document.querySelector(".weather-list");
    if (list)
      list.innerHTML = daily.time
        .slice(1, 4)
        .map(
          (date, index) =>
            `<div><span>${dayName(date)}</span><span>${codeIcon(daily.weather_code[index + 1])}</span><b>${Math.round(daily.temperature_2m_max[index + 1])}° / ${Math.round(daily.temperature_2m_min[index + 1])}°</b></div>`,
        )
        .join("");
    const source = panel?.closest(".dash-card")?.querySelector(".card-link");
    if (source) source.textContent = "Open‑Meteo लाइव";
  }
  async function refresh(location) {
    showLoading();
    try {
      const profile = location || {};
      let point;
      if (!point) {
        const query =
          [profile.village, profile.district, profile.state]
            .filter((part) => part && String(part).trim())
            .join(", ") || "Lucknow, Uttar Pradesh, India";
        try {
          point = await coordinates(query);
        } catch (error) {
          point = STATE_WEATHER_POINTS[profile.state] || DEFAULT_WEATHER_POINT;
        }
      }

      const url = new URL("https://api.open-meteo.com/v1/forecast");
      Object.entries({
        latitude: point.latitude,
        longitude: point.longitude,
        current:
          "temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m",
        daily: "weather_code,temperature_2m_max,temperature_2m_min",
        forecast_days: "5",
        timezone: "auto",
      }).forEach(([key, value]) => url.searchParams.set(key, value));
      const response = await fetch(url);
      if (!response.ok) throw new Error(`मौसम सेवा ${response.status}`);
      const data = await response.json();
      if (!data.current || !data.daily?.time?.length) {
        throw new Error("मौसम डेटा अधूरा है");
      }
      update(data.current, data.daily);
      return true;
    } catch (error) {
      console.warn("Weather update unavailable", error);
      const now = document.querySelector(".weather-now");
      if (now) {
        now.innerHTML =
          "<span>—</span><div><strong>—</strong><small>मौसम उपलब्ध नहीं<br>स्थान या सेवा की जाँच करें</small></div>";
      }
      const panel = document.querySelector(".weather-panel");
      if (panel) {
        panel.innerHTML =
          '<div class="weather-big">—</div><div><div class="weather-temperature">मौसम उपलब्ध नहीं</div><small>स्थान या मौसम सेवा की जाँच करें</small></div>';
      }
      document.querySelectorAll(".weather-day").forEach((node) => {
        node.innerHTML = "<span>—</span><b>—</b><small>उपलब्ध नहीं</small>";
      });
      return false;
    }
  }
  window.FarmLinkWeather = { refresh };
  const style = document.createElement("style");
  style.textContent =
    "@keyframes farmlinkWeatherShimmer{0%{background-position:200% 0}100%{background-position:-20% 0}}";
  document.head.append(style);
  showLoading();
})();
