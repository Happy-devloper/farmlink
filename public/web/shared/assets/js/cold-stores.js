(function () {
  const MAP_DEFAULT_ZOOM = 11;
  const API_BASE = "https://farmlink-retell-api.vercel.app";
  const LUCKNOW_STORES = [
    {
      id: "swaroop-cold-storage-aishbagh",
      name: "Swaroop Cold Storage Aishbagh",
      latitude: 26.8479235,
      longitude: 80.9085447,
      address: "267/43 Water Works Road, Aishbagh, Lucknow",
    },
    {
      id: "sanatan-cold-storage",
      name: "Sanatan Cold Storage",
      latitude: 26.9471802,
      longitude: 80.987432,
      address: "WXWP+VXF, Kusri Mahamudabad Marg, Lucknow",
    },
    {
      id: "chandra-cold-storage-bhandaris",
      name: "Chandra Cold Storage (Bhandari's)",
      latitude: 26.8415869,
      longitude: 80.8934189,
      address: "1/1 FCI Road, Lucknow",
    },
  ];
  const $ = (id) => document.getElementById(id);
  const state = {
    map: null,
    radiusCircle: null,
    userMarker: null,
    storeMarkers: null,
    location: null,
    locationName: "",
    stores: [],
    requestController: null,
    searchTimer: null,
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
    );
  }

  function setStatus(message, status) {
    $("coldStoresStatus").textContent = message;
    $("coldStoresStatus").dataset.state = status || "";
  }

  function distanceKm(from, to) {
    const radians = (degrees) => (degrees * Math.PI) / 180;
    const latitudeDiff = radians(to.latitude - from.latitude);
    const longitudeDiff = radians(to.longitude - from.longitude);
    const arc =
      Math.sin(latitudeDiff / 2) ** 2 +
      Math.cos(radians(from.latitude)) *
        Math.cos(radians(to.latitude)) *
        Math.sin(longitudeDiff / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
  }

  function currentRadius() {
    return Number($("radiusRange").value);
  }

  function getLucknowStores(radius) {
    return LUCKNOW_STORES.map((store) => ({
      ...store,
      tags: {},
      distanceKm: distanceKm(state.location, store),
    }))
      .filter((store) => store.distanceKm <= radius)
      .sort((left, right) => left.distanceKm - right.distanceKm);
  }

  function initMap() {
    if (!window.L || state.map) return Boolean(state.map);

    $("coldStoresMap").replaceChildren();
    const center = [state.location.latitude, state.location.longitude];
    state.map = window.L.map("coldStoresMap", {
      scrollWheelZoom: false,
      zoomControl: true,
    }).setView(center, MAP_DEFAULT_ZOOM);

    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(state.map);

    state.radiusCircle = window.L.circle(center, {
      radius: currentRadius() * 1000,
      color: "#27865a",
      weight: 2,
      fillColor: "#48a873",
      fillOpacity: 0.13,
    }).addTo(state.map);
    state.userMarker = window.L.circleMarker(center, {
      radius: 8,
      color: "#fff",
      weight: 3,
      fillColor: "#176042",
      fillOpacity: 1,
    })
      .bindPopup("आपकी लोकेशन")
      .addTo(state.map);
    state.storeMarkers = window.L.layerGroup().addTo(state.map);
    state.map.fitBounds(state.radiusCircle.getBounds().pad(0.12), {
      maxZoom: MAP_DEFAULT_ZOOM,
    });
    window.setTimeout(() => state.map.invalidateSize(), 0);
    return true;
  }

  function displayStores(stores) {
    const list = $("coldStoresList");
    $("resultsCount").textContent = `${stores.length} कोल्ड स्टोर · ${currentRadius()} किमी के अंदर`;

    if (!stores.length) {
      list.innerHTML = `<div class="cold-stores-empty card"><span aria-hidden="true">⌖</span><p>इस दायरे में कोई कोल्ड स्टोर नहीं मिला। दायरा बढ़ाकर देखें या दूसरा स्थान खोजें।</p></div>`;
      return;
    }

    list.innerHTML = stores
      .map((store) => {
        const address = store.address || [
          store.tags["addr:street"],
          store.tags["addr:city"],
          store.tags["addr:suburb"],
        ]
          .filter(Boolean)
          .join(", ");
        const contact = store.tags.phone || store.tags["contact:phone"];
        const directionsUrl = new URL(
          "https://www.google.com/maps/search/",
        );
        directionsUrl.searchParams.set("api", "1");
        directionsUrl.searchParams.set("query", `${store.name} ${address}`);
        return `<article class="cold-store-card card">
          <div class="cold-store-card-head">
            <h3>${escapeHtml(store.name)}</h3>
            <span class="cold-store-distance">${store.distanceKm.toFixed(1)} किमी</span>
          </div>
          <p class="cold-store-address">${escapeHtml(address || "पता OpenStreetMap पर उपलब्ध नहीं")}</p>
          <div class="cold-store-rate">दर के लिए संपर्क करें<small> / क्विंटल / माह</small><span class="cold-store-rate-caption">वर्तमान दर की पुष्टि सीधे स्टोर से करें</span></div>
          <div class="cold-store-card-actions">
            <span>${contact ? `फोन: ${escapeHtml(contact)}` : "फोन नंबर सूचीबद्ध नहीं"}</span>
            <a href="${escapeHtml(directionsUrl.href)}" target="_blank" rel="noopener noreferrer">विवरण देखें →</a>
          </div>
        </article>`;
      })
      .join("");
  }

  function updateMap(stores) {
    if (!initMap()) {
      $("coldStoresMap").innerHTML =
        '<div class="cold-stores-map-placeholder"><span aria-hidden="true">⌖</span><p>इंटरैक्टिव नक्शा लोड नहीं हो सका। स्टोरों की सूची नीचे उपलब्ध है।</p></div>';
      return;
    }

    const center = [state.location.latitude, state.location.longitude];
    state.radiusCircle.setLatLng(center).setRadius(currentRadius() * 1000);
    state.userMarker.setLatLng(center);
    state.map.setView(center, state.map.getZoom() || MAP_DEFAULT_ZOOM);
    state.storeMarkers.clearLayers();

    const markerIcon = window.L.divIcon({
      className: "",
      html: '<div class="cold-store-marker"><span>⌂</span></div>',
      iconSize: [32, 32],
      iconAnchor: [16, 30],
    });

    stores.forEach((store) => {
      const marker = window.L.marker([store.latitude, store.longitude], {
        icon: markerIcon,
      }).bindPopup(
        `<strong>${escapeHtml(store.name)}</strong><br>${store.distanceKm.toFixed(1)} किमी · वर्तमान दर स्टोर से पूछें`,
      );
      state.storeMarkers.addLayer(marker);
    });

    if (stores.length) {
      const bounds = state.radiusCircle.getBounds();
      stores.forEach((store) =>
        bounds.extend([store.latitude, store.longitude]),
      );
      state.map.fitBounds(bounds.pad(0.12), { maxZoom: 13 });
    }
  }

  function render(stores) {
    state.stores = stores;
    displayStores(stores);
    updateMap(stores);
  }

  async function searchStores() {
    if (!state.location) return;
    if (window.L) initMap();

    if (state.requestController) state.requestController.abort();
    const controller = new AbortController();
    state.requestController = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 18000);
    const radius = currentRadius();
    const localStores = getLucknowStores(radius);
    render(localStores);
    setStatus(`${radius} किमी के अंदर सूचीबद्ध स्टोर खोज रहे हैं…`, "loading");

    try {
      const params = new URLSearchParams({
        lat: String(state.location.latitude),
        lon: String(state.location.longitude),
        radius: String(radius),
      });
      const response = await fetch(`${API_BASE}/api/cold-stores?${params}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(
          payload.message || `कोल्ड स्टोर सेवा ने ${response.status} जवाब दिया।`,
        );
      if (!payload.ok || !Array.isArray(payload.stores))
        throw new Error(
          payload.message || "स्टोरों का डेटा सही प्रारूप में नहीं है।",
        );
      if (controller.signal.aborted) return;

      const liveStores = (payload.stores || [])
        .map((store) => {
          const latitude = Number(store.latitude);
          const longitude = Number(store.longitude);
          const tags = store.tags || {};
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
            return null;
          return {
            id: store.id,
            name: store.name || "कोल्ड स्टोर",
            tags,
            latitude,
            longitude,
            distanceKm: distanceKm(state.location, { latitude, longitude }),
          };
        })
        .filter(
          (store) => store && store.distanceKm <= radius && store.name.trim(),
        )
        .sort((left, right) => left.distanceKm - right.distanceKm)
        .filter(
          (store, index, all) =>
            all.findIndex(
              (item) =>
                item.name === store.name &&
                Math.abs(item.latitude - store.latitude) < 0.0001 &&
                Math.abs(item.longitude - store.longitude) < 0.0001,
            ) === index,
        );
      const stores = [...localStores, ...liveStores]
        .filter(
          (store, index, all) =>
            all.findIndex(
              (item) =>
                item.name.trim().toLocaleLowerCase() ===
                  store.name.trim().toLocaleLowerCase() &&
                distanceKm(item, store) < 0.5,
            ) === index,
        )
        .sort(
          (left, right) => left.distanceKm - right.distanceKm,
        );

      render(stores);
      setStatus(
        `खोज केंद्र: ${state.locationName} · ${radius} किमी के अंदर ${stores.length} सूचीबद्ध स्टोर मिले। दरें स्टोर से पक्की करें।`,
      );
    } catch (error) {
      if (controller.signal.aborted) {
        if (state.requestController === controller) {
          render(localStores);
          setStatus(
            localStores.length
              ? `लाइव सूची में समय लग रहा है। ${localStores.length} लखनऊ में सूचीबद्ध स्टोर दिखाए जा रहे हैं; दर और उपलब्धता सीधे पक्की करें।`
              : "स्टोर की खोज में समय लग रहा है। नेटवर्क जाँचें या थोड़ी देर बाद फिर कोशिश करें।",
            "error",
          );
        }
        return;
      }
      console.error("Nearby cold-store search failed:", error);
      render(localStores);
      setStatus(
        localStores.length
          ? `लाइव सूची लोड नहीं हो सकी। ${localStores.length} लखनऊ में सूचीबद्ध स्टोर दिखाए जा रहे हैं; दर और उपलब्धता सीधे पक्की करें।`
          : `नज़दीकी स्टोर खोज नहीं पाए: ${error.message} नेटवर्क जाँचकर फिर कोशिश करें।`,
        "error",
      );
    } finally {
      window.clearTimeout(timeoutId);
      if (state.requestController === controller)
        state.requestController = null;
    }
  }

  async function geocodePlace(place) {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", place);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "hi");
    url.searchParams.set("format", "json");
    const response = await fetch(url);
    if (!response.ok) throw new Error("स्थान खोज सेवा उपलब्ध नहीं है।");
    const payload = await response.json();
    const result = payload.results?.[0];
    if (!result) throw new Error("इस नाम का स्थान नहीं मिला।");
    return {
      latitude: Number(result.latitude),
      longitude: Number(result.longitude),
      name: [result.name, result.admin2, result.admin1]
        .filter(Boolean)
        .join(", "),
    };
  }

  async function useProfileLocation() {
    await window.firebaseScriptReady;
    const { client, user } = await getCurrentUser();
    if (!user) throw new Error("कृपया अपने खाते में लॉग इन करें।");
    const { data, error } = await client
      .from("farmer_profiles")
      .select("village,district,state")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    const place = [data?.village, data?.district, data?.state]
      .filter((part) => part && String(part).trim())
      .join(", ");
    if (!place) throw new Error("प्रोफाइल में स्थान नहीं है। शहर खोजें।");
    return geocodePlace(place);
  }

  async function setLocation(location) {
    if (
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude)
    )
      throw new Error("लोकेशन के निर्देशांक मान्य नहीं हैं।");
    state.location = location;
    state.locationName = location.name || "मेरी लोकेशन";
    $("mapLocationLabel").textContent = state.locationName;
    $("radiusRange").disabled = false;
    $("radiusHelp").textContent =
      "स्लाइडर खिसकाकर खोज का दायरा बदलें; नक्शे का घेरा उसी अनुसार बदलेगा।";
    await searchStores();
  }

  async function locateDevice() {
    setStatus("आपकी लोकेशन प्राप्त की जा रही है…", "loading");
    if (!navigator.geolocation) {
      setStatus(
        "इस ब्राउज़र में लोकेशन उपलब्ध नहीं है। नीचे शहर खोजें।",
        "error",
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          name: "मेरी लोकेशन",
        }).catch((error) => {
          console.error("Could not search at device location:", error);
          setStatus(error.message, "error");
        });
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "लोकेशन की अनुमति नहीं मिली। शहर खोजकर आगे बढ़ें।"
            : "लोकेशन नहीं मिल सकी। शहर खोजकर आगे बढ़ें।";
        setStatus(message, "error");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  function wireControls() {
    $("radiusRange").addEventListener("input", (event) => {
      const radius = Number(event.target.value);
      $("radiusOutput").value = `${radius} किमी`;
      $("radiusOutput").textContent = `${radius} किमी`;
      if (state.location && state.radiusCircle) {
        state.radiusCircle.setRadius(radius * 1000);
        state.map.fitBounds(state.radiusCircle.getBounds().pad(0.12), {
          maxZoom: MAP_DEFAULT_ZOOM,
        });
      }
      window.clearTimeout(state.searchTimer);
      if (state.location) {
        state.searchTimer = window.setTimeout(() => {
          void searchStores();
        }, 500);
      }
    });

    $("locateButton").addEventListener("click", locateDevice);
    $("placeForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const place = $("placeInput").value.trim();
      if (!place) return;
      setStatus(`${place} खोज रहे हैं…`, "loading");
      try {
        const location = await geocodePlace(place);
        await setLocation(location);
      } catch (error) {
        console.error("Place search failed:", error);
        setStatus(error.message, "error");
      }
    });
  }

  async function init() {
    wireControls();
    const mapScript = document.querySelector('script[src*="leaflet.js"]');
    mapScript?.addEventListener(
      "load",
      () => {
        if (state.location) updateMap(state.stores);
      },
      { once: true },
    );
    mapScript?.addEventListener(
      "error",
      () => {
        $("coldStoresMap").innerHTML =
          '<div class="cold-stores-map-placeholder"><span aria-hidden="true">⌖</span><p>इंटरैक्टिव नक्शा लोड नहीं हो सका। स्टोरों की सूची फिर भी उपलब्ध रहेगी।</p></div>';
      },
      { once: true },
    );
    await initShell("seller", "cold-stores", "नज़दीकी कोल्ड स्टोर");
    if (window.lucide) window.lucide.createIcons();
    try {
      const location = await useProfileLocation();
      await setLocation(location);
    } catch (error) {
      console.info("Saved farmer location unavailable:", error.message);
      setStatus(
        "अपनी लोकेशन उपयोग करें या नीचे गाँव/शहर खोजें।",
      );
    }
  }

  void init().catch((error) => {
    console.error("Cold-store finder failed to initialize:", error);
    setStatus(`कोल्ड स्टोर खोज तैयार नहीं हुई: ${error.message}`, "error");
  });
})();
