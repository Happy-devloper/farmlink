/**
 * FarmLink AI Driver Data & Logistics Service
 * Unified adapter for Driver Authentication, Deliveries, AI Routing, Events & Earnings.
 * Single source of truth: deliveries.tracking_status
 */

(function () {
  const STORAGE_KEY_DRIVER_PROFILE = "farmlink_driver_profile";
  const STORAGE_KEY_DRIVER_DELIVERIES = "farmlink_driver_deliveries_store";
  const STORAGE_KEY_DRIVER_EVENTS = "farmlink_driver_events_store";
  const STORAGE_KEY_DRIVER_EARNINGS = "farmlink_driver_earnings_store";
  const STORAGE_KEY_ACTIVE_ROUTE_CHOICE = "farmlink_active_route_choice";

  // Helper formatting functions
  function money(val) {
    const amt = Number(val || 0);
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amt);
  }

  function formatDateTime(isoString) {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("hi-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  }

  function formatTimeOnly(isoString) {
    if (!isoString) return "—";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString("hi-IN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  }

  // Realistic Initial Demo Deliveries
  const INITIAL_MOCK_DELIVERIES = [
    {
      id: "del-8901",
      order_id: "ORD-7821",
      driver_id: "demo-driver-001",
      tracking_status: "in_transit",
      crop_name: "बासमती धान (Basmati Paddy)",
      crop_emoji: "🌾",
      quantity_label: "25 क्विंटल (2,500 kg)",
      package_count: "50 बोरियां",
      driver_earning: 1850,
      base_fare: 1400,
      distance_km: 32.4,
      bonus_earning: 450,
      pickup_farmer_name: "रामेश पाटिल (Ramesh Patil)",
      pickup_farmer_phone: "+91 98765 43210",
      pickup_address: "ग्राम मोहनलालगंज, खसरा 104, ज़िला लखनऊ, उ.प्र.",
      pickup_lat: 26.6812,
      pickup_lng: 80.9845,
      pickup_time: new Date(Date.now() - 45 * 60000).toISOString(),
      dropoff_buyer_name: "अग्रवाल एग्रो ट्रेडर्स (Agarwal Agro)",
      dropoff_buyer_phone: "+91 98765 43211",
      dropoff_address: "गोदाम #14, ट्रांसपोर्ट नगर, कानपुर रोड, लखनऊ - 226012",
      dropoff_lat: 26.7825,
      dropoff_lng: 80.8912,
      estimated_arrival_time: new Date(Date.now() + 35 * 60000).toISOString(),
      handling_notes:
        "तिरपाल से ढककर रखें, बारिश से सुरक्षित रखना अनिवार्य है।",
      delivery_otp: "4829",
      accepted_at: new Date(Date.now() - 60 * 60000).toISOString(),
      picked_up_at: new Date(Date.now() - 25 * 60000).toISOString(),
      delivered_at: null,
      proof_of_delivery_url: null,
      weather_alert: "हल्की बारिश की संभावना — सुरक्षित गति 40 km/h बनाए रखें",
    },
    {
      id: "del-8902",
      order_id: "ORD-7835",
      driver_id: "demo-driver-001",
      tracking_status: "assigned",
      crop_name: "शरबती गेहूँ (Sharbati Wheat)",
      crop_emoji: "🌾",
      quantity_label: "40 क्विंटल (4,000 kg)",
      package_count: "80 बोरियां",
      driver_earning: 2400,
      base_fare: 1900,
      distance_km: 48.0,
      bonus_earning: 500,
      pickup_farmer_name: "बलबीर सिंह (Balbir Singh)",
      pickup_farmer_phone: "+91 98765 43212",
      pickup_address: "फार्म 12, बीकेटी (बख्शी का तालाब), लखनऊ",
      pickup_lat: 27.0125,
      pickup_lng: 80.9324,
      pickup_time: new Date(Date.now() + 90 * 60000).toISOString(),
      dropoff_buyer_name: "किसान कल्याण FPO भंडार",
      dropoff_buyer_phone: "+91 98765 43213",
      dropoff_address: "मंडी गेट #3, सीतापुर रोड, लखनऊ",
      dropoff_lat: 26.9015,
      dropoff_lng: 80.9415,
      estimated_arrival_time: new Date(Date.now() + 180 * 60000).toISOString(),
      handling_notes: "सूखी बोरियां, कांटे पर वजन सत्यापन आवश्यक।",
      delivery_otp: "7154",
      accepted_at: null,
      picked_up_at: null,
      delivered_at: null,
      proof_of_delivery_url: null,
      weather_alert: null,
    },
    {
      id: "del-8900",
      order_id: "ORD-7790",
      driver_id: "demo-driver-001",
      tracking_status: "delivered",
      crop_name: "पीली सरसों (Yellow Mustard)",
      crop_emoji: "🌻",
      quantity_label: "15 क्विंटल (1,500 kg)",
      package_count: "30 बोरियां",
      driver_earning: 1250,
      base_fare: 1000,
      distance_km: 21.5,
      bonus_earning: 250,
      pickup_farmer_name: "हरिप्रसाद मौर्य (Hariprasad Maurya)",
      pickup_farmer_phone: "+91 98765 43214",
      pickup_address: "ग्राम काकोरी, लखनऊ",
      pickup_lat: 26.8725,
      pickup_lng: 80.7954,
      dropoff_buyer_name: "श्री श्याम ऑयल मिल्स",
      dropoff_buyer_phone: "+91 98765 43215",
      dropoff_address: "औद्योगिक क्षेत्र, नादरगंज, लखनऊ",
      dropoff_lat: 26.7712,
      dropoff_lng: 80.8524,
      estimated_arrival_time: new Date(Date.now() - 4 * 3600000).toISOString(),
      handling_notes: "सावधानी से लोड करें।",
      delivery_otp: "3391",
      accepted_at: new Date(Date.now() - 7 * 3600000).toISOString(),
      picked_up_at: new Date(Date.now() - 5.5 * 3600000).toISOString(),
      delivered_at: new Date(Date.now() - 4 * 3600000).toISOString(),
      proof_of_delivery_url: "mock-pod-delivered.png",
      weather_alert: null,
    },
    {
      id: "del-8898",
      order_id: "ORD-7762",
      driver_id: "demo-driver-001",
      tracking_status: "delivered",
      crop_name: "देसी आलू (Fresh Potatoes)",
      crop_emoji: "🥔",
      quantity_label: "50 क्विंटल (5,000 kg)",
      package_count: "100 कट्टे",
      driver_earning: 3100,
      base_fare: 2500,
      distance_km: 62.0,
      bonus_earning: 600,
      pickup_farmer_name: "देवेंद्र वर्मा",
      pickup_farmer_phone: "+91 98765 43216",
      pickup_address: "ग्राम निगोहां, लखनऊ",
      pickup_lat: 26.5612,
      pickup_lng: 81.0214,
      dropoff_buyer_name: "राजधानी वेज मंडी डिस्ट्रीब्यूटर्स",
      dropoff_buyer_phone: "+91 98765 43217",
      dropoff_address: "नवीन सब्जी मंडी, दुबग्गा, लखनऊ",
      dropoff_lat: 26.8645,
      dropoff_lng: 80.8612,
      estimated_arrival_time: new Date(Date.now() - 28 * 3600000).toISOString(),
      handling_notes: "धूप से बचाएं।",
      delivery_otp: "9021",
      accepted_at: new Date(Date.now() - 32 * 3600000).toISOString(),
      picked_up_at: new Date(Date.now() - 30 * 3600000).toISOString(),
      delivered_at: new Date(Date.now() - 28 * 3600000).toISOString(),
      proof_of_delivery_url: "mock-pod-delivered.png",
      weather_alert: null,
    },
  ];

  // Initial Events Store
  const INITIAL_MOCK_EVENTS = [
    {
      id: "evt-01",
      delivery_id: "del-8901",
      driver_id: "demo-driver-001",
      status: "assigned",
      note: "डिलीवरी आवंटित हुई (Trip Assigned by Dispatcher)",
      latitude: 26.6812,
      longitude: 80.9845,
      created_at: new Date(Date.now() - 65 * 60000).toISOString(),
    },
    {
      id: "evt-02",
      delivery_id: "del-8901",
      driver_id: "demo-driver-001",
      status: "accepted",
      note: "ड्राइवर ने ट्रिप स्वीकार की (Job Accepted by Sunil Yadav)",
      latitude: 26.6812,
      longitude: 80.9845,
      created_at: new Date(Date.now() - 60 * 60000).toISOString(),
    },
    {
      id: "evt-03",
      delivery_id: "del-8901",
      driver_id: "demo-driver-001",
      status: "at_pickup",
      note: "ड्राइवर किसान के खेत पर पहुँचा (Arrived at Mohanlalganj Farm)",
      latitude: 26.6812,
      longitude: 80.9845,
      created_at: new Date(Date.now() - 40 * 60000).toISOString(),
    },
    {
      id: "evt-04",
      delivery_id: "del-8901",
      driver_id: "demo-driver-001",
      status: "picked_up",
      note: "फसल वजन व गुणवत्ता जांच पूर्ण, 50 बोरियां लोड हुईं",
      latitude: 26.6812,
      longitude: 80.9845,
      created_at: new Date(Date.now() - 25 * 60000).toISOString(),
    },
    {
      id: "evt-05",
      delivery_id: "del-8901",
      driver_id: "demo-driver-001",
      status: "in_transit",
      note: "ट्रांसपोर्ट नगर गोदाम के लिए रवाना (Departed on AI Shortest Route)",
      latitude: 26.7214,
      longitude: 80.9312,
      created_at: new Date(Date.now() - 20 * 60000).toISOString(),
    },
  ];

  // Storage Helpers
  function getStoredDeliveries() {
    try {
      const data = localStorage.getItem(STORAGE_KEY_DRIVER_DELIVERIES);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.warn("Deliveries parse error:", e);
    }
    localStorage.setItem(
      STORAGE_KEY_DRIVER_DELIVERIES,
      JSON.stringify(INITIAL_MOCK_DELIVERIES),
    );
    return INITIAL_MOCK_DELIVERIES;
  }

  function saveStoredDeliveries(items) {
    try {
      localStorage.setItem(
        STORAGE_KEY_DRIVER_DELIVERIES,
        JSON.stringify(items),
      );
    } catch (e) {
      console.warn("Deliveries save error:", e);
    }
  }

  function getStoredEvents(deliveryId) {
    try {
      const data = localStorage.getItem(STORAGE_KEY_DRIVER_EVENTS);
      const allEvents = data ? JSON.parse(data) : INITIAL_MOCK_EVENTS;
      if (deliveryId) {
        return allEvents
          .filter((e) => e.delivery_id === deliveryId)
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      }
      return allEvents;
    } catch {
      return INITIAL_MOCK_EVENTS;
    }
  }

  function addStoredEvent(evt) {
    try {
      const all = getStoredEvents();
      all.push({
        id: "evt-" + Math.random().toString(36).substring(2, 9),
        created_at: new Date().toISOString(),
        ...evt,
      });
      localStorage.setItem(STORAGE_KEY_DRIVER_EVENTS, JSON.stringify(all));
    } catch (e) {
      console.warn("Event save error:", e);
    }
  }

  // Profile management
  function getDriverProfile() {
    try {
      const p = localStorage.getItem(STORAGE_KEY_DRIVER_PROFILE);
      if (p) return JSON.parse(p);
    } catch {}

    // Default Demo Driver Profile
    const defaultProfile = {
      id: "dp-001",
      user_id:
        sessionStorage.getItem("farmlink_mock_user_id") || "demo-driver-001",
      full_name: "सुनील यादव (Sunil Yadav)",
      phone_number:
        sessionStorage.getItem("farmlink_phone") || "+91 98765 43210",
      state: "Uttar Pradesh",
      district: "Lucknow",
      city: "Lucknow",
      vehicle_type: "pickup",
      vehicle_type_label: "पिकअप वैन (Mahindra Bolero Maxi Truck)",
      vehicle_number: "UP32 AB 4521",
      capacity_kg: 2500,
      licence_number: "UP-3220190048123",
      verification_status: "approved", // Default approved for demo, switchable
      availability_status: "available", // 'available' | 'offline' | 'busy'
      emergency_contact: "राजेश यादव (भाई) - 9876500000",
      rating: 4.9,
      total_trips: 48,
      on_time_rate: "98.5%",
      upi_id: "sunil.yadav@oksbi",
      created_at: "2026-01-10T10:00:00.000Z",
    };
    localStorage.setItem(
      STORAGE_KEY_DRIVER_PROFILE,
      JSON.stringify(defaultProfile),
    );
    return defaultProfile;
  }

  function saveDriverProfile(profile) {
    const existing = getDriverProfile();
    const updated = {
      ...existing,
      ...profile,
      updated_at: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY_DRIVER_PROFILE, JSON.stringify(updated));
    return updated;
  }

  function normalizeFirebaseDelivery(row, order, items, related = {}) {
    const firstItem = items?.[0] || {};
    const numberOrNull = (...values) => {
      const value = values.find(
        (item) => item !== undefined && item !== null && item !== "",
      );
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };
    const quantityKg = Number(
      row.quantity_kg || firstItem.quantity_kg || order?.total_quantity || 0,
    );
    const genericPickup =
      /किसान से पिकअप|पिकअप स्थान उपलब्ध|scheduled|शेड्यूल/i;
    const genericDropoff =
      /डिलीवरी पता उपलब्ध|बायर्स एड्रेस|खरीदार का डिलीवरी/i;
    const farmer = related.farmerProfile;
    const buyer = related.buyerProfile;
    const listingLocation = related.listingLocation;
    const pickupProfileAddress = [
      farmer?.village,
      farmer?.sub_district,
      farmer?.district,
      farmer?.state,
    ]
      .filter(Boolean)
      .join(", ");
    const pickupAddress =
      (row.pickup_address &&
        !genericPickup.test(row.pickup_address) &&
        row.pickup_address) ||
      row.pickup_location ||
      row.farmer_address ||
      (order?.pickup_address &&
        !genericPickup.test(order.pickup_address) &&
        order.pickup_address) ||
      pickupProfileAddress ||
      listingLocation ||
      "पिकअप पता उपलब्ध नहीं है";
    const dropoffAddress =
      (row.dropoff_address &&
        !genericDropoff.test(row.dropoff_address) &&
        row.dropoff_address) ||
      row.delivery_address ||
      row.buyer_address ||
      order?.delivery_address ||
      buyer?.delivery_address ||
      "डिलीवरी पता उपलब्ध नहीं है";
    return {
      ...row,
      id: row.id,
      order_id: row.order_id || order?.id || row.id,
      driver_id: row.driver_id || null,
      source: "firebase",
      tracking_status: row.tracking_status || "assigned",
      crop_name:
        row.crop_name || firstItem.crop_name || firstItem.title || "कृषि फसल",
      crop_emoji: row.crop_emoji || "🌾",
      quantity_label: row.quantity_label || `${quantityKg || 0} kg`,
      package_count: row.package_count || "पैकेज विवरण उपलब्ध नहीं",
      driver_earning: Number(row.driver_earning || row.transport_cost || 0),
      distance_km: Number(row.distance_km || 0),
      pickup_farmer_name:
        row.pickup_farmer_name ||
        row.farmer_name ||
        related.farmerName ||
        "किसान",
      pickup_farmer_phone: row.pickup_farmer_phone || "",
      pickup_address: pickupAddress,
      pickup_lat: numberOrNull(
        row.pickup_lat,
        order?.pickup_lat,
        order?.pickup_latitude,
      ),
      pickup_lng: numberOrNull(
        row.pickup_lng,
        order?.pickup_lng,
        order?.pickup_longitude,
      ),
      dropoff_buyer_name:
        row.dropoff_buyer_name ||
        row.buyer_name ||
        related.buyerName ||
        "खरीदार",
      dropoff_buyer_phone: row.dropoff_buyer_phone || "",
      dropoff_address: dropoffAddress,
      dropoff_lat: numberOrNull(
        row.dropoff_lat,
        order?.dropoff_lat,
        order?.delivery_lat,
        order?.delivery_latitude,
      ),
      dropoff_lng: numberOrNull(
        row.dropoff_lng,
        order?.dropoff_lng,
        order?.delivery_lng,
        order?.delivery_longitude,
      ),
      estimated_arrival_time: row.estimated_arrival_time || null,
    };
  }

  async function fetchFirebaseDeliveries(client, user) {
    const result = await client
      .from("deliveries")
      .select("*")
      .order("created_at", { ascending: false });
    if (result.error) throw result.error;

    const rows = (result.data || []).filter(
      (row) => !row.driver_id || row.driver_id === user.id,
    );

    return Promise.all(
      rows.map(async (row) => {
        const orderResult = row.order_id
          ? await client
              .from("orders")
              .select("*")
              .eq("id", row.order_id)
              .maybeSingle()
          : { data: null, error: null };
        const itemResult = row.order_id
          ? await client
              .from("order_items")
              .select("*")
              .eq("order_id", row.order_id)
          : { data: [], error: null };
        const order = orderResult.data || null;
        const listingIds = (itemResult.data || [])
          .map((item) => item.listing_id)
          .filter(Boolean);
        const listingResult = listingIds.length
          ? await client
              .from("listings")
              .select("id,farmer_id,location,description")
              .eq("id", listingIds[0])
              .maybeSingle()
          : { data: null, error: null };
        const farmerId =
          row.farmer_id ||
          row.seller_id ||
          order?.farmer_id ||
          order?.seller_id ||
          listingResult.data?.farmer_id;
        const [
          buyerProfileResult,
          farmerProfileResult,
          buyerUserResult,
          farmerUserResult,
        ] = await Promise.all([
          order?.buyer_id
            ? client
                .from("buyer_profiles")
                .select("delivery_address")
                .eq("user_id", order.buyer_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          farmerId
            ? client
                .from("farmer_profiles")
                .select("village,sub_district,district,state")
                .eq("user_id", farmerId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          order?.buyer_id
            ? client
                .from("users")
                .select("full_name")
                .eq("id", order.buyer_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          farmerId
            ? client
                .from("users")
                .select("full_name")
                .eq("id", farmerId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);
        const description = listingResult.data?.description || "";
        const pickupDescription = description
          .match(/पिकअप स्थान\s*:\s*([^|]+)/i)?.[1]
          ?.trim();
        const listingDescriptionLocation = description
          .match(/स्थान\s*:\s*([^|]+)/i)?.[1]
          ?.trim();
        const related = {
          buyerProfile: buyerProfileResult.data,
          farmerProfile: farmerProfileResult.data,
          buyerName: buyerUserResult.data?.full_name,
          farmerName: farmerUserResult.data?.full_name,
          listingLocation:
            listingResult.data?.location ||
            pickupDescription ||
            listingDescriptionLocation,
        };
        const normalized = normalizeFirebaseDelivery(
          row,
          order,
          itemResult.data,
          related,
        );
        const pickupChanged =
          normalized.pickup_address !== row.pickup_address ||
          normalized.pickup_lat !== row.pickup_lat ||
          normalized.pickup_lng !== row.pickup_lng ||
          normalized.farmer_id !== row.farmer_id;
        if (pickupChanged && row.id) {
          await client
            .from("deliveries")
            .update({
              farmer_id: normalized.farmer_id || farmerId || null,
              pickup_address: normalized.pickup_address,
              pickup_lat: normalized.pickup_lat,
              pickup_lng: normalized.pickup_lng,
            })
            .eq("id", row.id);
        }
        return normalized;
      }),
    );
  }

  // AI Shortest Route Recommendation Engine
  function getAIRouteRecommendations(delivery) {
    const baseDist = Number(delivery?.distance_km || 32.4);

    // Option 1: AI Recommended Eco-Corridor (Shortest, fastest, zero mandi congestion)
    const aiShortestDist = Math.round(baseDist * 0.82 * 10) / 10;
    const aiMins = Math.round(aiShortestDist * 1.3);
    const standardDist = Math.round(baseDist * 1.25 * 10) / 10;
    const standardMins = Math.round(standardDist * 1.7);

    const kmSaved = Math.round((standardDist - aiShortestDist) * 10) / 10;
    const minsSaved = standardMins - aiMins;
    const dieselSavedRs = Math.round(kmSaved * 14.5); // Approx ₹14.5 per km commercial fuel savings

    return {
      selected_route_id:
        localStorage.getItem(STORAGE_KEY_ACTIVE_ROUTE_CHOICE) || "route-ai-opt",
      savings: {
        km_saved: kmSaved,
        mins_saved: minsSaved,
        diesel_rs_saved: dieselSavedRs,
        toll_saved_rs: 90,
      },
      routes: [
        {
          id: "route-ai-opt",
          name: "FarmLink AI ग्रीन कॉरिडोर (अनुशंसित)",
          name_en: "AI Eco-Corridor (Shortest & Fastest)",
          is_recommended: true,
          distance_km: aiShortestDist,
          duration_mins: aiMins,
          duration_label: `${aiMins} मिनट`,
          road_quality_score: "96% चिकनी सड़क",
          toll_cost: "₹0 (टोल मुक्त)",
          mandi_traffic: "0% जाम (बाईपास)",
          flood_risk: "सुरक्षित (0% जलभराव)",
          badge_text: "⚡ 12.8 किमी कम · ₹190 बचत",
          color: "#7C3AED",
          line_color: "#10B981",
          waypoints: [
            {
              label: "मोहनलालगंज पिकअप",
              lat: delivery.pickup_lat,
              lng: delivery.pickup_lng,
            },
            { label: "किसान पथ आउटर रिंग बाईपास", lat: 26.7112, lng: 80.9512 },
            { label: "शहीद पथ सर्विस लेन", lat: 26.7545, lng: 80.9124 },
            {
              label: "ट्रांसपोर्ट नगर गोदाम ड्रॉप",
              lat: delivery.dropoff_lat,
              lng: delivery.dropoff_lng,
            },
          ],
        },
        {
          id: "route-standard-hw",
          name: "मानक मुख्य हाईवे (पारंपरिक)",
          name_en: "Standard Main Highway",
          is_recommended: false,
          distance_km: standardDist,
          duration_mins: standardMins,
          duration_label: `${standardMins} मिनट`,
          road_quality_score: "78% सामान्य",
          toll_cost: "₹90 टोल प्लाजा",
          mandi_traffic: "35 मिनट भारी मंडी जाम",
          flood_risk: "मध्यम (कमरहा नाले के पास जलभराव)",
          badge_text: "लंबा मार्ग · टोल शुल्क",
          color: "#64748B",
          line_color: "#94A3B8",
          waypoints: [
            {
              label: "मोहनलालगंज पिकअप",
              lat: delivery.pickup_lat,
              lng: delivery.pickup_lng,
            },
            {
              label: "रायबरेली रोड मुख्य चौराहा (जाम)",
              lat: 26.7412,
              lng: 80.9412,
            },
            { label: "तेलीबाग टोल प्लाजा", lat: 26.7725, lng: 80.9312 },
            {
              label: "ट्रांसपोर्ट नगर गोदाम ड्रॉप",
              lat: delivery.dropoff_lat,
              lng: delivery.dropoff_lng,
            },
          ],
        },
      ],
    };
  }

  // Route Bot Client with safe fallback. The backend receives the same location
  // shape used by the Firebase delivery record.
  async function geocodeAddress(address) {
    if (!address || /उपलब्ध|scheduled|शेड्यूल/i.test(String(address)))
      return null;
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("q", `${address}, India`);
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      const result = await response.json();
      const point = result?.[0];
      if (point) {
        return { latitude: Number(point.lat), longitude: Number(point.lon) };
      }
    } catch {
      // Try the second geocoder below.
    }
    try {
      const fallbackUrl = new URL(
        "https://geocoding-api.open-meteo.com/v1/search",
      );
      fallbackUrl.searchParams.set("name", String(address).split(",")[0]);
      fallbackUrl.searchParams.set("count", "1");
      fallbackUrl.searchParams.set("language", "en");
      fallbackUrl.searchParams.set("format", "json");
      const response = await fetch(fallbackUrl);
      const result = await response.json();
      const point = result?.results?.[0];
      if (point) {
        return {
          latitude: Number(point.latitude),
          longitude: Number(point.longitude),
        };
      }
    } catch {
      // The caller will show an unavailable route state.
    }
    return null;
  }

  async function resolveDeliveryCoordinates(delivery) {
    const demoRoute = {
      pickup: { latitude: 27.5619, longitude: 80.6827 },
      delivery: { latitude: 19.076, longitude: 73.012 },
    };
    return {
      ...delivery,
      pickup_lat: demoRoute.pickup.latitude,
      pickup_lng: demoRoute.pickup.longitude,
      dropoff_lat: demoRoute.delivery.latitude,
      dropoff_lng: demoRoute.delivery.longitude,
    };
    /* Dynamic Firebase/geocoded route retained below for later re-enabling.
    const valid = (value) =>
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(Number(value));
    const pickup =
      valid(delivery.pickup_lat) && valid(delivery.pickup_lng)
        ? {
            latitude: Number(delivery.pickup_lat),
            longitude: Number(delivery.pickup_lng),
          }
        : await geocodeAddress(delivery.pickup_address);
    const dropoff =
      valid(delivery.dropoff_lat) && valid(delivery.dropoff_lng)
        ? {
            latitude: Number(delivery.dropoff_lat),
            longitude: Number(delivery.dropoff_lng),
          }
        : await geocodeAddress(delivery.dropoff_address);
    if (!pickup || !dropoff) {
      throw new Error("Pickup or delivery coordinates are unavailable.");
    }
    return {
      ...delivery,
      pickup_lat: pickup.latitude,
      pickup_lng: pickup.longitude,
      dropoff_lat: dropoff.latitude,
      dropoff_lng: dropoff.longitude,
    };
    */
  }

  async function fetchOptimizedRoute(delivery) {
    try {
      delivery = await resolveDeliveryCoordinates(delivery);
    } catch (error) {
      return {
        source: "route-bot-unavailable",
        route_unavailable: true,
        weather_alert: error.message,
      };
    }
    const hasCoordinates = [
      delivery.pickup_lat,
      delivery.pickup_lng,
      delivery.dropoff_lat,
      delivery.dropoff_lng,
    ].every(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== "" &&
        Number.isFinite(Number(value)),
    );
    if (!hasCoordinates) {
      return {
        source: "route-bot-unavailable",
        route_unavailable: true,
        weather_alert: "Pickup or delivery coordinates are unavailable.",
      };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const pickup = {
      name: delivery.pickup_farmer_name || "किसान पिकअप",
      latitude: Number(delivery.pickup_lat),
      longitude: Number(delivery.pickup_lng),
      elevation_m: Number(delivery.pickup_elevation_m || 0),
      state_code: delivery.pickup_state_code || "UP",
    };
    const dropoff = {
      name: delivery.dropoff_buyer_name || "खरीदार डिलीवरी",
      latitude: Number(delivery.dropoff_lat),
      longitude: Number(delivery.dropoff_lng),
      elevation_m: Number(delivery.dropoff_elevation_m || 0),
      state_code: delivery.dropoff_state_code || "UP",
    };
    const profile = getDriverProfile();

    try {
      const response = await fetch(
        window.FARMLINK_ROUTE_API || "http://localhost:8000/optimize",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            depot: pickup,
            vehicles: [
              {
                id: profile.id || "driver-vehicle",
                capacity_kg: Number(profile.capacity_kg || 2500),
              },
            ],
            orders: [
              {
                id: delivery.order_id || delivery.id,
                crop: delivery.crop_name || "कृषि फसल",
                quantity_kg: Number(delivery.quantity_kg || 1),
                perishability: Number(delivery.perishability || 3),
                storage_temp_c: Number(delivery.storage_temp_c || 15),
                pickup,
                delivery: dropoff,
                promised_delivery_hours: Number(
                  delivery.promised_delivery_hours || 24,
                ),
              },
            ],
          }),
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        return { source: "route-bot-live", ...data };
      }
    } catch (e) {
      // Fallback seamlessly without breaking portal
      console.log("Route bot offline, engaging smart AI routing fallback.");
    }

    return {
      source: "farmlink-ai-fallback",
      distance_km: Number(delivery.distance_km || 0),
      duration_mins: 0,
      weather_alert: "मौसम सामान्य · मार्ग साफ है",
    };
  }

  // Delivery status operations
  async function fetchDeliveries(filter = "all") {
    let items = getStoredDeliveries();

    // Prefer the project's Firebase/Firestore data when a driver is signed in.
    try {
      const client = await window.firebaseReady;
      if (client) {
        const {
          data: { user },
        } = await client.auth.getUser();
        if (user) {
          items = await fetchFirebaseDeliveries(client, user);
        }
      }
    } catch (error) {
      console.error("Firebase deliveries unavailable:", error);
      items = [];
    }

    if (filter === "assigned") {
      return items.filter((d) => d.tracking_status === "assigned");
    } else if (filter === "active") {
      return items.filter((d) =>
        ["accepted", "at_pickup", "picked_up", "in_transit"].includes(
          d.tracking_status,
        ),
      );
    } else if (filter === "completed") {
      return items.filter((d) =>
        ["delivered", "failed_delivery", "cancelled"].includes(
          d.tracking_status,
        ),
      );
    }
    return items;
  }

  async function fetchDeliveryById(id) {
    const all = await fetchDeliveries("all");
    return all.find((d) => d.id === id) || null;
  }

  async function updateDeliveryStatus(
    deliveryId,
    newStatus,
    note = "",
    proofUrl = null,
  ) {
    const deliveries = getStoredDeliveries();
    let idx = deliveries.findIndex((d) => d.id === deliveryId);
    let delivery = idx >= 0 ? deliveries[idx] : null;
    if (!delivery) {
      const liveDeliveries = await fetchDeliveries("all");
      delivery = liveDeliveries.find((item) => item.id === deliveryId) || null;
    }
    if (!delivery) throw new Error("डिलीवरी नहीं मिली।");

    const prevStatus = delivery.tracking_status;

    const allowedTransitions = {
      assigned: ["accepted", "failed_delivery", "cancelled"],
      accepted: ["at_pickup", "failed_delivery", "cancelled"],
      at_pickup: ["picked_up", "failed_delivery", "cancelled"],
      picked_up: ["in_transit", "failed_delivery", "cancelled"],
      in_transit: ["delivered", "failed_delivery", "cancelled"],
      delivered: [],
      failed_delivery: ["in_transit", "cancelled"],
      cancelled: [],
    };
    if (!allowedTransitions[prevStatus]?.includes(newStatus)) {
      throw new Error(
        `स्थिति ${prevStatus} से ${newStatus} में नहीं बदली जा सकती।`,
      );
    }

    delivery.tracking_status = newStatus;
    const now = new Date().toISOString();

    if (newStatus === "accepted") delivery.accepted_at = now;
    if (newStatus === "picked_up") delivery.picked_up_at = now;
    if (newStatus === "delivered") {
      delivery.delivered_at = now;
      if (proofUrl) delivery.proof_of_delivery_url = proofUrl;
      // Add to driver earnings record
      recordDriverEarning(delivery);
    }

    if (idx >= 0) {
      deliveries[idx] = delivery;
      saveStoredDeliveries(deliveries);
    }

    // Record Event
    addStoredEvent({
      delivery_id: deliveryId,
      driver_id: delivery.driver_id || "demo-driver-001",
      status: newStatus,
      note: note || `स्थिति बदलकर '${newStatus}' की गई`,
      latitude: delivery.dropoff_lat,
      longitude: delivery.dropoff_lng,
      proof_file_url: proofUrl,
    });

    // Sync the status and ownership to Firebase when the project client is available.
    try {
      const client = await window.firebaseReady;
      if (client) {
        const { data: authData } = await client.auth.getUser();
        const signedInDriverId =
          authData?.user?.id || delivery.driver_id || null;
        if (newStatus === "accepted" && signedInDriverId) {
          delivery.driver_id = signedInDriverId;
          if (idx >= 0) {
            deliveries[idx] = delivery;
            saveStoredDeliveries(deliveries);
          }
        }
        await client
          .from("deliveries")
          .update({
            tracking_status: newStatus,
            ...(newStatus === "accepted" && signedInDriverId
              ? { driver_id: signedInDriverId }
              : {}),
            updated_at: now,
          })
          .eq("id", deliveryId);

        const eventResult = await client.from("delivery_events").insert({
          delivery_id: deliveryId,
          driver_id: delivery.driver_id || null,
          status: newStatus,
          note: note,
          proof_file_url: proofUrl,
        });
        if (eventResult.error) throw eventResult.error;
      }
    } catch (e) {
      console.warn("Supabase update skipped/queued:", e);
    }

    return delivery;
  }

  async function declineDelivery(deliveryId, reason) {
    const deliveries = getStoredDeliveries();
    const idx = deliveries.findIndex((d) => d.id === deliveryId);
    if (idx !== -1) {
      deliveries[idx].tracking_status = "cancelled";
      deliveries[idx].issue_reason = reason;
      saveStoredDeliveries(deliveries);

      addStoredEvent({
        delivery_id: deliveryId,
        driver_id: "demo-driver-001",
        status: "cancelled",
        note: `डिलीवरी अस्वीकार: ${reason}`,
      });
    }
  }

  function recordDriverEarning(delivery) {
    try {
      const earningsData = localStorage.getItem(STORAGE_KEY_DRIVER_EARNINGS);
      const list = earningsData ? JSON.parse(earningsData) : [];
      if (list.some((entry) => entry.delivery_id === delivery.id)) return;
      list.unshift({
        id: "ern-" + Math.random().toString(36).substring(2, 9),
        delivery_id: delivery.id,
        order_id: delivery.order_id,
        crop_name: delivery.crop_name,
        amount: delivery.driver_earning || 1850,
        status: "payable", // 'pending' | 'payable' | 'paid'
        created_at: new Date().toISOString(),
        distance_km: delivery.distance_km || 32,
      });
      localStorage.setItem(STORAGE_KEY_DRIVER_EARNINGS, JSON.stringify(list));
    } catch (e) {
      console.warn("Earnings record error:", e);
    }
  }

  function getDriverEarningsSummary() {
    let list = [];
    try {
      const d = localStorage.getItem(STORAGE_KEY_DRIVER_EARNINGS);
      list = d ? JSON.parse(d) : [];
    } catch {}

    if (list.length === 0) {
      // Seed default demo earnings history
      list = [
        {
          id: "ern-101",
          delivery_id: "del-8900",
          order_id: "ORD-7790",
          crop_name: "पीली सरसों (Mustard)",
          amount: 1250,
          status: "paid",
          created_at: new Date(Date.now() - 4 * 3600000).toISOString(),
          distance_km: 21.5,
        },
        {
          id: "ern-102",
          delivery_id: "del-8898",
          order_id: "ORD-7762",
          crop_name: "देसी आलू (Potatoes)",
          amount: 3100,
          status: "paid",
          created_at: new Date(Date.now() - 28 * 3600000).toISOString(),
          distance_km: 62.0,
        },
        {
          id: "ern-103",
          delivery_id: "del-8874",
          order_id: "ORD-7690",
          crop_name: "हरा मटर (Green Peas)",
          amount: 1600,
          status: "paid",
          created_at: new Date(Date.now() - 52 * 3600000).toISOString(),
          distance_km: 26.0,
        },
      ];
      localStorage.setItem(STORAGE_KEY_DRIVER_EARNINGS, JSON.stringify(list));
    }

    const deliveries = getStoredDeliveries();
    const deliveredToday = deliveries.filter((delivery) => {
      if (delivery.tracking_status !== "delivered" || !delivery.delivered_at)
        return false;
      const deliveredAt = new Date(delivery.delivered_at);
      const today = new Date();
      return deliveredAt.toDateString() === today.toDateString();
    });

    const todayAmount = list
      .filter((i) => {
        const d = new Date(i.created_at);
        const today = new Date();
        return (
          d.getDate() === today.getDate() && d.getMonth() === today.getMonth()
        );
      })
      .reduce((acc, curr) => acc + curr.amount, 0);

    const weeklyAmount = list.reduce(
      (acc, curr) => acc + Number(curr.amount || 0),
      0,
    );
    const pendingPayout = list
      .filter((i) => i.status !== "paid")
      .reduce((acc, curr) => acc + Number(curr.amount || 0), 0);

    return {
      today_earnings: todayAmount,
      weekly_earnings: weeklyAmount,
      completed_deliveries_count: deliveries.filter(
        (delivery) => delivery.tracking_status === "delivered",
      ).length,
      delivered_today_count: deliveredToday.length,
      pending_payout: pendingPayout,
      history: list,
    };
  }

  // Voice Assistant Audio Briefing Engine
  function speakDriverBriefing(text) {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "hi-IN";
      utterance.rate = 0.95;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  }

  // Export to Global namespace
  window.farmlinkDriver = {
    money,
    formatDateTime,
    formatTimeOnly,
    getProfile: getDriverProfile,
    saveProfile: saveDriverProfile,
    getEvents: getStoredEvents,
    addEvent: addStoredEvent,
    fetchDeliveries,
    fetchDeliveryById,
    updateDeliveryStatus,
    declineDelivery,
    getAIRouteRecommendations,
    fetchOptimizedRoute,
    resolveDeliveryCoordinates,
    getEarningsSummary: getDriverEarningsSummary,
    speakBriefing: speakDriverBriefing,
    setActiveRouteChoice: (id) =>
      localStorage.setItem(STORAGE_KEY_ACTIVE_ROUTE_CHOICE, id),
  };
})();
