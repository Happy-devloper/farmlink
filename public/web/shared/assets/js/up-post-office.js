/* Uttar Pradesh postal-location helper. The supplied data.gov.in key is intended
 * for this public prototype; production should proxy this call server-side. */
(function () {
  function unique(values) {
    return [
      ...new Set(values.filter(Boolean).map((value) => String(value).trim())),
    ].sort((a, b) => a.localeCompare(b, "hi"));
  }

  async function lookupPincode(pincode) {
    const pin = String(pincode || "").replace(/\D/g, "");
    if (!/^\d{6}$/.test(pin))
      throw new Error("6 अंकों का सही पिनकोड दर्ज करें।");
    const response = await fetch(
      `https://api.postalpincode.in/pincode/${encodeURIComponent(pin)}`,
    );
    if (!response.ok)
      throw new Error("Postal location service अभी उपलब्ध नहीं है।");
    const payload = await response.json();
    const records = (payload?.[0]?.PostOffice || []).filter(
      (record) => String(record.State || "").toUpperCase() === "UTTAR PRADESH",
    );
    if (!records.length)
      throw new Error(
        "इस पिनकोड के लिए Uttar Pradesh में कोई Post Office नहीं मिला।",
      );
    const preferredRecord =
      records.find(
        (record) =>
          String(record.DeliveryStatus || "").toLowerCase() === "delivery",
      ) || records[0];
    return {
      pincode: pin,
      district: unique(records.map((record) => record.District))[0] || "",
      postOffices: unique(records.map((record) => record.Name)),
      defaultPostOffice: preferredRecord?.Name || "",
      latitude: Number(preferredRecord?.Latitude),
      longitude: Number(preferredRecord?.Longitude),
    };
  }

  function populatePostOffices(select, offices, selected) {
    select.replaceChildren(new Option("Post Office चुनें", ""));
    offices.forEach((office) =>
      select.add(new Option(office, office, false, office === selected)),
    );
    if (selected && !offices.includes(selected))
      select.add(new Option(selected, selected, true, true));
    select.disabled = offices.length === 0;
  }

  function field(labelText, control) {
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const label = document.createElement("label");
    label.htmlFor = control.id;
    label.textContent = labelText;
    wrapper.append(label, control);
    return wrapper;
  }

  function cropSelect(previous) {
    const select = document.createElement("select");
    select.id = previous.id;
    select.name = previous.name || previous.id;
    select.multiple = true;
    select.size = 5;
    select.style.cssText = previous.style.cssText;
    [
      "गेहूं",
      "धान",
      "मक्का",
      "सरसों",
      "चना",
      "अरहर",
      "आलू",
      "गन्ना",
      "सब्ज़ियाँ",
    ].forEach((crop) => select.add(new Option(crop, crop)));
    const stored = String(previous.value || "")
      .split(",")
      .map((value) => value.trim());
    [...select.options].forEach((option) => {
      option.selected = stored.includes(option.value);
    });
    Object.defineProperty(select, "value", {
      configurable: true,
      get() {
        return [...select.selectedOptions]
          .map((option) => option.value)
          .join(", ");
      },
      set(value) {
        const values = String(value || "")
          .split(",")
          .map((item) => item.trim());
        [...select.options].forEach((option) => {
          option.selected = values.includes(option.value);
        });
      },
    });
    previous.replaceWith(select);
    return select;
  }

  function postOfficeSelect(previous) {
    const select = document.createElement("select");
    select.id = previous.id;
    select.name = previous.name || previous.id;
    select.required = previous.required;
    select.style.cssText = previous.style.cssText;
    select.dataset.savedValue = previous.value || "";
    previous.replaceWith(select);
    Object.defineProperty(select, "value", {
      configurable: true,
      get() {
        return select.options[select.selectedIndex]?.value || "";
      },
      set(value) {
        const match = [...select.options].find(
          (option) => option.value === value,
        );
        if (match) match.selected = true;
        else if (value) select.add(new Option(value, value, true, true));
      },
    });
    populatePostOffices(select, [], "");
    return select;
  }

  function mountPostalLocation() {
    const form =
      document.getElementById("regForm") ||
      document.getElementById("profileForm");
    let stateInput = document.getElementById("state");
    const district =
      document.getElementById("dist") || document.getElementById("district");
    const village = document.getElementById("village");
    const crops = document.getElementById("crops");
    const subDistrict =
      document.getElementById("subdistrict") ||
      document.getElementById("subDistrict");
    if (
      !form ||
      !stateInput ||
      !district ||
      !village ||
      stateInput.dataset.postalReady
    )
      return;
    stateInput.dataset.postalReady = "true";
    if (stateInput.tagName === "SELECT") {
      const lockedInput = document.createElement("input");
      lockedInput.id = stateInput.id;
      lockedInput.name = stateInput.name || stateInput.id;
      lockedInput.required = stateInput.required;
      lockedInput.style.cssText = stateInput.style.cssText;
      stateInput.replaceWith(lockedInput);
      stateInput = lockedInput;
    }
    stateInput.value = "Uttar Pradesh";
    Object.defineProperty(stateInput, "value", {
      configurable: true,
      get() {
        return "Uttar Pradesh";
      },
      set() {},
    });
    stateInput.readOnly = true;
    stateInput.disabled = true;
    stateInput.style.cssText +=
      ";background:#f1f8f3;color:#176b42;font-weight:700";
    district.readOnly = true;
    district.placeholder = "पिनकोड से अपने-आप आएगा";
    district.style.cssText += ";background:#f8fafc";
    if (subDistrict) {
      subDistrict.value = "";
      subDistrict.type = "hidden";
      const subDistrictField = subDistrict.closest(".field");
      if (subDistrictField) subDistrictField.replaceWith(subDistrict);
    }
    const officeSelect = postOfficeSelect(village);
    cropSelect(crops);
    const landField = document.getElementById("land")?.closest(".field");
    const cropsField = document.getElementById("crops")?.closest(".field");
    if (landField) landField.style.display = "none";
    if (cropsField) cropsField.style.display = "none";

    const pin = document.createElement("input");
    pin.id = "pincode";
    pin.type = "text";
    pin.inputMode = "numeric";
    pin.maxLength = 6;
    pin.placeholder = "6 अंकों का पिनकोड";
    pin.required = true;
    pin.style.cssText = "border:1.5px solid #cbd5e1;flex:1";
    const lookupButton = document.createElement("button");
    lookupButton.type = "button";
    lookupButton.className = "btn btn-secondary";
    lookupButton.textContent = "ढूँढें";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px";
    row.append(pin, lookupButton);
    const hint = document.createElement("small");
    hint.style.cssText = "display:block;margin-top:6px;color:#64748b";
    hint.textContent = "पिनकोड से District और Post Office अपने-आप आएँगे।";
    const postalField = field("पिनकोड · Pincode", row);
    postalField.append(hint);
    district.closest(".field").insertAdjacentElement("afterend", postalField);
    const villageLabel = officeSelect.closest(".field").querySelector("label");
    if (villageLabel) villageLabel.textContent = "पोस्ट ऑफिस · Post Office";

    async function search() {
      lookupButton.disabled = true;
      hint.textContent = "Post Office खोज रहे हैं…";
      try {
        const result = await lookupPincode(pin.value);
        pin.value = result.pincode;
        district.value = result.district;
        populatePostOffices(
          officeSelect,
          result.postOffices,
          officeSelect.dataset.savedValue || result.defaultPostOffice,
        );
        officeSelect.disabled = true;
        officeSelect.dataset.savedValue = "";
        hint.textContent = `${result.postOffices.length} Post Office मिले — एक Post Office अपने-आप चुन लिया गया है।`;
      } catch (error) {
        district.value = "";
        populatePostOffices(officeSelect, []);
        hint.textContent = error.message;
      } finally {
        lookupButton.disabled = false;
      }
    }
    lookupButton.addEventListener("click", search);
    pin.addEventListener("change", search);

    if (form.id === "profileForm") {
      (async () => {
        try {
          await window.firebaseScriptReady;
          const { client, user } = await getCurrentUser();
          if (!user) return;
          const result = await client
            .from("farmer_profiles")
            .select("postal_code,village")
            .eq("user_id", user.id)
            .maybeSingle();
          if (result.error || !result.data?.postal_code) return;
          pin.value = result.data.postal_code;
          officeSelect.dataset.savedValue = result.data.village || "";
          await search();
        } catch (error) {
          console.warn("Saved postal location could not be restored:", error);
        }
      })();
    }
  }

  window.FarmLinkPostOffice = {
    lookupPincode,
    populatePostOffices,
    mountPostalLocation,
    state: "Uttar Pradesh",
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mountPostalLocation);
  else mountPostalLocation();
})();
