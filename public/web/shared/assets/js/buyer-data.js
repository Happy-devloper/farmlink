(function () {
  function money(value) {
    const amount = Number(value || 0);
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(amount);
  }

  function shortDate(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleDateString("hi-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return value;
    }
  }

  function parseDescription(description) {
    const result = { location: "स्थान उपलब्ध नहीं", seller: "सत्यापित किसान" };
    if (!description) return result;

    const parts = String(description)
      .split("|")
      .map((part) => part.trim());
    for (const part of parts) {
      if (!part.includes(":")) continue;
      const [key, ...rest] = part.split(":");
      const value = rest.join(":").trim();
      if (!value) continue;
      if (key.toLowerCase().includes("स्थान")) result.location = value;
      if (
        key.toLowerCase().includes("फसल") ||
        key.toLowerCase().includes("ग्रेड")
      ) {
        result.grade = value;
      }
      if (key.toLowerCase().includes("उपलब्धता")) result.availability = value;
    }

    return result;
  }

  function cropEmoji(title, category) {
    const value = (title || category || "").toLowerCase();
    const map = {
      wheat: "🌾",
      rice: "🌾",
      mustard: "🌻",
      maize: "🌽",
      chana: "🫘",
      pulse: "🫘",
      gram: "🫘",
      potato: "🥔",
      onion: "🧅",
      vegetable: "🥬",
      fruits: "🍊",
      spices: "🌶️",
      grains: "🌾",
    };

    for (const key in map) {
      if (value.includes(key)) return map[key];
    }
    return category === "vegetables" ? "🥬" : "🌾";
  }

  function normalizeListingRow(row) {
    const meta = parseDescription(row.description);
    const quantityKg = Number(row.available_quantity_kg || 0);
    const pricePerKg = Number(row.price_per_kg || 0);
    const pricePerQuintal = Math.round(pricePerKg * 100);

    return {
      id: row.id,
      farmerId: row.farmer_id || null,
      title: row.title || "फसल",
      category: row.category || "grains",
      description: row.description || "",
      seller: meta.seller,
      location: meta.location,
      quantityKg,
      quantityQuintalLabel: `${Math.max(1, Math.round(quantityKg / 100))} क्विंटल`,
      pricePerKg,
      pricePerQuintal,
      status: row.status || "active",
      createdAt: row.created_at,
      emoji: cropEmoji(row.title, row.category),
      grade: meta.grade || "Grade A",
    };
  }

  function getBuyerCart() {
    try {
      return JSON.parse(localStorage.getItem("farmlink_buyer_cart") || "[]");
    } catch (error) {
      return [];
    }
  }

  function saveBuyerCart(cart) {
    localStorage.setItem("farmlink_buyer_cart", JSON.stringify(cart));
  }

  async function ensureFirebaseClient() {
    const startedAt = Date.now();

    while (true) {
      if (window.firebaseScriptReady) {
        await window.firebaseScriptReady;
      }

      if (window.firebaseReady) {
        try {
          await window.firebaseReady;
        } catch (error) {
          throw error;
        }

        if (window.firebaseClient) {
          return window.firebaseClient;
        }
      }

      if (Date.now() - startedAt > 15000) {
        throw new Error("Firebase client is not initialized.");
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async function requireBuyerSession() {
    const client = await ensureFirebaseClient();
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData.session?.user) {
      window.location.href = "../../login.html";
      return null;
    }
    return sessionData.session.user;
  }

  async function fetchBuyerProfile() {
    const user = await requireBuyerSession();
    if (!user) return null;

    const { data: userRow, error: userError } = await window.firebaseClient
      .from("users")
      .select("id, full_name, phone_number, role, verified")
      .eq("id", user.id)
      .maybeSingle();

    if (userError) throw userError;

    const { data: buyerProfile, error: profileError } =
      await window.firebaseClient
        .from("buyer_profiles")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

    if (profileError) throw profileError;

    return {
      user: userRow || {
        id: user.id,
        full_name: "Buyer",
        phone_number: user.phone || null,
      },
      profile: buyerProfile || { delivery_address: "", pin_code: "" },
    };
  }

  async function fetchBuyerListings() {
    const client = await ensureFirebaseClient();
    const { data, error } = await client
      .from("listings")
      .select(
        "id,farmer_id,title,description,category,price_per_kg,available_quantity_kg,status,created_at",
      )
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map(normalizeListingRow);
  }

  async function fetchListingById(id) {
    const client = await ensureFirebaseClient();
    const { data, error } = await client
      .from("listings")
      .select(
        "id,farmer_id,title,description,category,price_per_kg,available_quantity_kg,status,created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    return data ? normalizeListingRow(data) : null;
  }

  async function fetchBuyerOrders() {
    const user = await requireBuyerSession();
    if (!user) return [];

    const client = await ensureFirebaseClient();
    const { data, error } = await client
      .from("orders")
      .select("*")
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  async function fetchBuyerOrderById(orderId) {
    const user = await requireBuyerSession();
    if (!user) return null;

    const client = await ensureFirebaseClient();
    const { data, error } = await client
      .from("orders")
      .select("*")
      .eq("buyer_id", user.id)
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }

  async function fetchSellerOrderStatuses(orderId) {
    const client = await ensureFirebaseClient();
    const { data, error } = await client
      .from("seller_order_status")
      .select("id,seller_id,status,order_id,updated_at")
      .eq("order_id", orderId);
    if (error) throw error;
    return data || [];
  }

  async function cancelBuyerOrder(orderId) {
    const user = await requireBuyerSession();
    if (!user) return null;
    const client = await ensureFirebaseClient();
    const { data: order, error: orderError } = await client
      .from("orders")
      .select("id,order_status")
      .eq("id", orderId)
      .eq("buyer_id", user.id)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) throw new Error("ऑर्डर नहीं मिला।");
    if (!["pending", "accepted", "picking"].includes(order.order_status)) {
      throw new Error("इस स्थिति में ऑर्डर रद्द नहीं किया जा सकता।");
    }
    const { error: updateError } = await client
      .from("orders")
      .update({ order_status: "cancelled", payment_status: "refunded" })
      .eq("id", orderId)
      .eq("buyer_id", user.id);
    if (updateError) throw updateError;
    const { error: paymentError } = await client
      .from("payments")
      .update({ status: "refunded" })
      .eq("order_id", orderId);
    if (paymentError) throw paymentError;
    const statuses = await fetchSellerOrderStatuses(orderId);
    await Promise.all(
      statuses.map(async (entry) => {
        const result = await client
          .from("seller_order_status")
          .update({ status: "cancelled" })
          .eq("id", entry.id);
        if (result.error) throw result.error;
      }),
    );
    return order;
  }

  async function placeBuyerOrder({
    address,
    items,
    paymentMethod,
    deliveryMethod,
    orderTotal,
  }) {
    const user = await requireBuyerSession();
    if (!user) return null;

    const client = await ensureFirebaseClient();
    const listingRows = await Promise.all(
      items.map((item) => fetchListingById(item.listingId)),
    );
    for (let index = 0; index < items.length; index += 1) {
      const listing = listingRows[index];
      const quantity = Number(items[index].quantityKg || 0);
      if (
        !listing ||
        listing.status !== "active" ||
        quantity <= 0 ||
        quantity > Number(listing.quantityKg || 0)
      ) {
        throw new Error(
          `“${items[index].title || "फसल"}” की चुनी हुई मात्रा उपलब्ध नहीं है।`,
        );
      }
    }
    const totalAmount = items.reduce(
      (sum, item) =>
        sum + Number(item.pricePerKg || 0) * Number(item.quantityKg || 0),
      0,
    );
    const { data: order, error: orderError } = await client
      .from("orders")
      .insert([
        {
          buyer_id: user.id,
          total_amount: Number(orderTotal || totalAmount),
          payment_status: "paid",
          order_status: "pending",
          delivery_address: address,
        },
      ])
      .select()
      .single();

    if (orderError) throw orderError;

    const orderItems = items.map((item) => ({
      order_id: order.id,
      listing_id: item.listingId,
      price_per_kg: Number(item.pricePerKg || 0),
      quantity_kg: Number(item.quantityKg || 0),
    }));

    const { error: itemError } = await client
      .from("order_items")
      .insert(orderItems);
    if (itemError) throw itemError;

    await Promise.all(
      listingRows.map(async (listing, index) => {
        const remaining = Math.max(
          0,
          Number(listing.quantityKg || 0) -
            Number(items[index].quantityKg || 0),
        );
        const result = await client
          .from("listings")
          .update({
            available_quantity_kg: remaining,
            status: remaining === 0 ? "sold_out" : "active",
          })
          .eq("id", listing.id);
        if (result.error) throw result.error;
      }),
    );

    const { error: paymentError } = await client.from("payments").insert({
      order_id: order.id,
      payment_method: paymentMethod || "upi",
      status: "completed",
      amount: Number(orderTotal || totalAmount),
      transaction_ref: `DEMO-${String(order.id).slice(0, 8)}`,
    });
    if (paymentError) throw paymentError;

    if (deliveryMethod !== "pickup") {
      const estimatedArrival = new Date(
        Date.now() + 2 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const primaryListing = listingRows[0];
      const farmerProfileResult = primaryListing?.farmerId
        ? await client
            .from("farmer_profiles")
            .select("village,sub_district,district,state,latitude,longitude")
            .eq("user_id", primaryListing.farmerId)
            .maybeSingle()
        : { data: null, error: null };
      if (farmerProfileResult.error) throw farmerProfileResult.error;
      const farmerProfile = farmerProfileResult.data;
      const pickupAddress =
        [
          farmerProfile?.village,
          farmerProfile?.sub_district,
          farmerProfile?.district,
          farmerProfile?.state,
        ]
          .filter(Boolean)
          .join(", ") ||
        primaryListing?.location ||
        "पिकअप पता उपलब्ध नहीं है";
      const { error: deliveryError } = await client.from("deliveries").insert({
        order_id: order.id,
        farmer_id: primaryListing?.farmerId || null,
        pickup_address: pickupAddress,
        pickup_lat: Number.isFinite(Number(farmerProfile?.latitude))
          ? Number(farmerProfile.latitude)
          : null,
        pickup_lng: Number.isFinite(Number(farmerProfile?.longitude))
          ? Number(farmerProfile.longitude)
          : null,
        dropoff_address: address,
        tracking_status: "assigned",
        estimated_arrival_time: estimatedArrival,
      });
      if (deliveryError) throw deliveryError;
    }

    return order;
  }

  function orderStatusBadge(status) {
    const statusMap = {
      pending: "pill pill-neutral",
      accepted: "pill pill-info",
      picking: "pill pill-info",
      shipped: "pill pill-info",
      delivered: "pill pill-success",
      cancelled: "pill pill-neutral",
    };

    const labels = {
      pending: "पेंडिंग",
      accepted: "स्वीकृत",
      picking: "पिकिंग",
      shipped: "शिप किया गया",
      delivered: "पहुँच गया",
      cancelled: "रद्द",
    };

    return `<span class="${statusMap[status] || "pill pill-neutral"}">${labels[status] || status || "पेंडिंग"}</span>`;
  }

  function formatOrderAmount(order) {
    const value = Number(order.total_amount || 0);
    return money(value);
  }

  window.farmlinkBuyerData = {
    money,
    shortDate,
    parseDescription,
    cropEmoji,
    getBuyerCart,
    saveBuyerCart,
    fetchBuyerProfile,
    fetchBuyerListings,
    fetchListingById,
    fetchBuyerOrders,
    fetchBuyerOrderById,
    fetchSellerOrderStatuses,
    cancelBuyerOrder,
    placeBuyerOrder,
    orderStatusBadge,
    formatOrderAmount,
    normalizeListingRow,
  };
})();
