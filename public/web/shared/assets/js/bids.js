(function () {
  const allowedStatuses = new Set(["pending", "accepted", "rejected"]);

  async function getSession() {
    if (window.firebaseScriptReady) await window.firebaseScriptReady;
    const client = await window.firebaseReady;
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error("बोली देने के लिए लॉग इन करें।");
    return { client, user: data.user };
  }

  async function getRole(client, userId) {
    const { data, error } = await client
      .from("users")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data?.role || null;
  }

  async function requireRole(client, userId, role) {
    const actualRole = await getRole(client, userId);
    if (actualRole !== role)
      throw new Error(
        role === "buyer"
          ? "केवल खरीदार बोली भेज सकते हैं।"
          : "यह पेज किसान खातों के लिए है।",
      );
  }

  async function createBid(listing, pricePerQuintal, quantityKg) {
    const { client, user } = await getSession();
    await requireRole(client, user.id, "buyer");
    const price = Number(pricePerQuintal);
    const quantity = Number(quantityKg);
    const available = Number(listing.quantityKg);

    if (!listing.id || !listing.farmerId || listing.status !== "active")
      throw new Error("यह लिस्टिंग अब बोली के लिए उपलब्ध नहीं है।");
    if (listing.farmerId === user.id)
      throw new Error("आप अपनी ही लिस्टिंग पर बोली नहीं लगा सकते।");
    if (!Number.isFinite(price) || price <= 0)
      throw new Error("प्रति क्विंटल वैध कीमत दर्ज करें।");
    if (
      !Number.isInteger(quantity) ||
      quantity < 100 ||
      quantity > available
    )
      throw new Error("मात्रा 1 क्विंटल से उपलब्ध मात्रा तक होनी चाहिए।");

    const { error } = await client.from("bids").insert({
      listing_id: listing.id,
      listing_title: listing.title,
      farmer_id: listing.farmerId,
      buyer_id: user.id,
      offer_price_per_quintal: price,
      quantity_kg: quantity,
      status: "pending",
    });
    if (error) throw error;
  }

  async function fetchMyBids(role) {
    if (role !== "buyer" && role !== "farmer")
      throw new Error("बोली सूची का प्रकार मान्य नहीं है।");
    const { client, user } = await getSession();
    await requireRole(client, user.id, role);
    const ownerField = role === "buyer" ? "buyer_id" : "farmer_id";
    const { data, error } = await client
      .from("bids")
      .select("*")
      .eq(ownerField, user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function respondToBid(id, status) {
    if (!allowedStatuses.has(status) || status === "pending")
      throw new Error("बोली का जवाब मान्य नहीं है।");
    const { client, user } = await getSession();
    await requireRole(client, user.id, "farmer");
    const { data: bid, error: bidError } = await client
      .from("bids")
      .select("*")
      .eq("id", id)
      .eq("farmer_id", user.id)
      .maybeSingle();
    if (bidError) throw bidError;
    if (!bid || bid.status !== "pending")
      throw new Error("यह बोली पहले ही जवाब पा चुकी है।");

    if (status === "accepted") {
      const { data: listing, error: listingError } = await client
        .from("listings")
        .select("status,available_quantity_kg")
        .eq("id", bid.listing_id)
        .maybeSingle();
      if (listingError) throw listingError;
      if (
        !listing ||
        listing.status !== "active" ||
        Number(listing.available_quantity_kg) < Number(bid.quantity_kg)
      )
        throw new Error("लिस्टिंग या उपलब्ध मात्रा बदल गई है; यह बोली स्वीकार नहीं की जा सकती।");
    }

    const { data, error } = await client
      .from("bids")
      .update({ status })
      .eq("id", id)
      .eq("farmer_id", user.id)
      .eq("status", "pending");
    if (error) throw error;
    if (!data?.length) throw new Error("बोली का जवाब सेव नहीं हुआ। फिर से कोशिश करें।");
  }

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

  function money(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  function statusLabel(status) {
    return (
      {
        pending: "जवाब बाकी",
        accepted: "स्वीकार",
        rejected: "अस्वीकार",
      }[status] || "अज्ञात"
    );
  }

  window.farmlinkBids = {
    getSession,
    getRole,
    createBid,
    fetchMyBids,
    respondToBid,
    escapeHtml,
    money,
    statusLabel,
  };
})();
