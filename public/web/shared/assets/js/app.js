// KisanMandi shared shell — injects sidebar + topbar, handles active states & mobile drawer.

function mountPageShimmer() {
  const shimmer = document.createElement("div");
  shimmer.className = "page-shimmer";
  shimmer.setAttribute("role", "status");
  shimmer.setAttribute("aria-label", "पेज लोड हो रहा है");
  shimmer.innerHTML = `<div class="page-shimmer-side"><div class="sh-line" style="width:70%;height:28px"></div>${Array.from({ length: 8 }, () => '<div class="sh-nav"></div>').join("")}</div><div class="page-shimmer-main"><div class="sh-line" style="width:180px;height:14px"></div><div class="sh-line" style="width:300px;height:32px;margin-top:13px"></div><div class="page-shimmer-row"><div class="sh-card"></div><div class="sh-card"></div><div class="sh-card"></div></div><div class="page-shimmer-row"><div class="sh-card" style="min-height:240px"></div><div class="sh-card" style="min-height:240px"></div></div></div>`;
  document.body.prepend(shimmer);
  const dismiss = async () => {
    try {
      if (window.authGuardReady) await window.authGuardReady;
      if (window.firebaseScriptReady) await window.firebaseScriptReady;
    } catch {
      /* A page error renders its own error state after the shimmer. */
    }
    window.setTimeout(() => {
      shimmer.classList.add("is-hidden");
      window.setTimeout(() => shimmer.remove(), 220);
    }, 260);
  };
  dismiss();
}

const SELLER_NAV = [
  { key: "home", label: "होम", href: "seller-dashboard.html", icon: "home" },
  {
    key: "listings",
    label: "मेरी लिस्टिंग",
    href: "seller-listings.html",
    icon: "layout-list",
  },
  {
    key: "lots",
    label: "लॉट प्रबंधन",
    href: "seller-lots.html",
    icon: "boxes",
  },
  {
    key: "orders",
    label: "ऑर्डर",
    href: "seller-orders.html",
    icon: "shopping-bag",
  },
  {
    key: "bids",
    label: "खरीद प्रस्ताव",
    href: "seller-bids.html",
    icon: "hand-coins",
  },
  {
    key: "pickup",
    label: "पिकअप और डिलीवरी",
    href: "pickup-route-tracking.html",
    icon: "truck",
  },
  {
    key: "cold-stores",
    label: "कोल्ड स्टोर खोजें",
    href: "seller-cold-stores.html",
    icon: "warehouse",
  },
  {
    key: "earnings",
    label: "कमाई और भुगतान",
    href: "seller-earnings.html",
    icon: "indian-rupee",
  },
  {
    key: "ai",
    label: "AI सुझाव",
    href: "seller-ai-insights.html",
    icon: "sparkles",
  },
  {
    key: "voice",
    label: "वॉइस सहायता",
    href: "seller-voice-assistant.html",
    icon: "mic",
  },
  {
    key: "help",
    label: "सहायता केंद्र",
    href: "help-center.html",
    icon: "help-circle",
  },
];

const BUYER_NAV = [
  { key: "home", label: "होम", href: "buyer-dashboard.html", icon: "home" },
  {
    key: "marketplace",
    label: "बाज़ार",
    href: "buyer-marketplace.html",
    icon: "store",
  },
  {
    key: "cart",
    label: "कार्ट",
    href: "buyer-cart.html",
    icon: "shopping-cart",
  },
  { key: "orders", label: "ऑर्डर", href: "buyer-orders.html", icon: "package" },
  {
    key: "bids",
    label: "मेरी बोलियाँ",
    href: "buyer-bids.html",
    icon: "hand-coins",
  },
  {
    key: "profile",
    label: "प्रोफाइल",
    href: "buyer-profile.html",
    icon: "user",
  },
  {
    key: "help",
    label: "सहायता",
    href: "help-center.html",
    icon: "help-circle",
  },
];

async function initShell(role, activeKey, title) {
  if (window.authGuardReady && !(await window.authGuardReady)) return;
  if (window.firebaseScriptReady) await window.firebaseScriptReady;
  if (
    typeof requireVerifiedUser === "function" &&
    !(await requireVerifiedUser())
  )
    return;
  const nav = role === "buyer" ? BUYER_NAV : SELLER_NAV;

  const navHtml = nav
    .map(
      (item) => `
    <a href="${item.href}" class="${item.key === activeKey ? "active" : ""}">
      <span class="nav-icon"><i data-lucide="${item.icon}"></i></span>
      <span>${item.label}</span>
    </a>`,
    )
    .join("");

  const sidebar = document.createElement("div");
  sidebar.innerHTML = `
    <div class="sidebar-scrim" id="scrim"></div>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <div class="logo-wrap">
          <span class="logo-icon"><i data-lucide="leaf"></i></span>
          <div class="logo-text">
            <span class="brand-title">FarmLink <span class="ai-text">AI</span></span>
            <span class="brand-sub">खेती smarter, भविष्य बेहतर</span>
          </div>
        </div>
      </div>
      <nav class="sidebar-nav">${navHtml}</nav>
      ${
        role === "seller"
          ? `
      <div class="sidebar-foot-profile">
        <div class="profile-card-mini">
          <div class="avatar-mini">
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Ramesh" alt="Ramesh Patil" />
          </div>
          <div class="profile-details-mini">
            <a href="seller-profile.html" class="profile-name-mini">रमेश पाटिल &nbsp;<strong>&rsaquo;</strong></a>
            <span class="kyc-badge-mini"><span class="dot-green"></span> KYC सत्यापित</span>
          </div>
        </div>
      </div>
      `
          : `
      <div class="sidebar-foot">Bharosemand kisan bazaar<br>v1.0</div>
      `
      }
    </aside>`;
  document.body.prepend(sidebar);

  const shellRoot = document.getElementById("app-shell");
  if (shellRoot) shellRoot.classList.add("app-shell");

  const header = document.getElementById("topbar-slot");
  if (header) {
    header.outerHTML = `
    <header class="topbar" style="display:none;">
      <!-- Hidden topbar as the dashboard now uses inline greetings and sidebar layout -->
    </header>`;
  }

  const menuBtn = document.getElementById("menuBtn");
  const sb = document.getElementById("sidebar");
  const scrim = document.getElementById("scrim");
  if (menuBtn) {
    menuBtn.addEventListener("click", () => {
      sb.classList.add("open");
      scrim.classList.add("show");
    });
    scrim.addEventListener("click", () => {
      sb.classList.remove("open");
      scrim.classList.remove("show");
    });
  }

  // Load Lucide Icons dynamically if not loaded, then run createIcons
  if (!window.lucide) {
    const lucideScript = document.createElement("script");
    lucideScript.src = "https://unpkg.com/lucide@latest";
    lucideScript.onload = () => {
      if (window.lucide) {
        window.lucide.createIcons();
      }
    };
    document.head.appendChild(lucideScript);
  } else {
    window.lucide.createIcons();
  }
}

function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<i data-lucide="info" style="width:16px;height:16px;"></i> <span>${msg}</span>`;
  document.body.appendChild(t);

  if (window.lucide) {
    window.lucide.createIcons();
  }

  setTimeout(() => {
    t.style.opacity = "0";
    t.style.transform = "translateY(10px)";
    t.style.transition = "all 0.3s ease";
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

// Simple OTP input auto-advance helper
function wireOtpInputs(selector) {
  const inputs = document.querySelectorAll(selector);
  inputs.forEach((inp, i) => {
    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/[^0-9]/g, "").slice(0, 1);
      if (inp.value && inputs[i + 1]) inputs[i + 1].focus();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !inp.value && inputs[i - 1])
        inputs[i - 1].focus();
    });
  });
}

// Dynamically load Firebase integration client.
(function () {
  const s = document.createElement("script");
  s.src = new URL("firebase.js", document.currentScript.src).href;
  window.firebaseScriptReady = new Promise((resolve) => {
    s.onload = resolve;
    s.onerror = resolve;
  });
  document.head.appendChild(s);
})();

// Every page under web/pages is protected.  The login screen is the only
// public entry point, so direct URLs cannot expose seller, buyer, or onboarding
// screens without a Firebase session.
(function protectPages() {
  const isAppPage = /\/web\/pages\//.test(window.location.pathname);
  if (!isAppPage) {
    window.authGuardReady = Promise.resolve(true);
    return;
  }

  document.documentElement.style.visibility = "hidden";
  const loginUrl = new URL("../../../login.html", window.location.href);

  window.authGuardReady = (async () => {
    try {
      await window.firebaseScriptReady;
      const client = await window.firebaseReady;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session?.user) {
        window.location.replace(loginUrl.href);
        return false;
      }

      document.documentElement.style.visibility = "";
      return true;
    } catch (error) {
      console.warn("Authentication guard failed:", error);
      window.location.replace(loginUrl.href);
      return false;
    }
  })();
})();

mountPageShimmer();
