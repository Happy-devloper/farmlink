/**
 * FarmLink Driver Shell — Topbar with Desktop Nav, AI Voice Assistant Modal, and Mobile Bottom Navigation
 */

(function () {
  const DRIVER_NAV = [
    { key: "home", label: "होम", href: "driver-dashboard.html", icon: "home" },
    {
      key: "deliveries",
      label: "डिलीवरी",
      href: "driver-deliveries.html",
      icon: "truck",
    },
    {
      key: "earnings",
      label: "कमाई",
      href: "driver-earnings.html",
      icon: "indian-rupee",
    },
    {
      key: "profile",
      label: "प्रोफाइल",
      href: "driver-profile.html",
      icon: "user",
    },
  ];

  function initDriverShell(activeNavKey, pageTitle = "") {
    const frame = document.querySelector(".driver-app-frame") || document.body;

    // 1. Inject Topbar with responsive Desktop Navigation
    const topbarSlot = document.getElementById("driver-topbar-slot");
    if (topbarSlot) {
      const desktopNavHtml = DRIVER_NAV.map(
        (item) => `
          <a href="${item.href}" class="desktop-nav-link ${item.key === activeNavKey ? "active" : ""}">
            <i data-lucide="${item.icon}" style="width:16px;height:16px;"></i>
            <span>${item.label}</span>
          </a>
        `,
      ).join("");

      topbarSlot.innerHTML = `
        <header class="driver-header">
          <a href="driver-dashboard.html" class="driver-brand">
            <div class="driver-brand-icon"><i data-lucide="truck"></i></div>
            <div>
              <div class="driver-brand-title">FarmLink <span style="color:var(--primary);">Driver</span></div>
              <div class="driver-brand-tag"><span style="width:6px;height:6px;border-radius:50%;background:var(--success);"></span> सारथी पोर्टल</div>
            </div>
          </a>

          <!-- Desktop Navigation Menu (Visible on Laptop & Tablets >= 768px) -->
          <nav class="desktop-nav-menu">
            ${desktopNavHtml}
          </nav>

          <div class="header-actions">
            <button class="btn-ai-assistant" id="btnOpenAiAssistant" title="AI वॉइस सारथी">
              <i data-lucide="mic" style="width:14px;height:14px;"></i>
              <span>AI सारथी</span>
            </button>
            <a href="driver-profile.html#support" class="btn-icon-head" title="सहायता">
              <i data-lucide="life-buoy" style="width:18px;height:18px;"></i>
            </a>
          </div>
        </header>
      `;
    }

    // 2. Inject Mobile Fixed Bottom Navigation (Visible on phones < 768px)
    if (activeNavKey) {
      const bottomNav = document.createElement("nav");
      bottomNav.className = "driver-bottom-nav";
      bottomNav.innerHTML = DRIVER_NAV.map(
        (item) => `
          <a href="${item.href}" class="nav-item ${item.key === activeNavKey ? "active" : ""}">
            <i data-lucide="${item.icon}"></i>
            <span>${item.label}</span>
          </a>
        `,
      ).join("");
      frame.appendChild(bottomNav);
    }

    // Route details uses the optimizer only; keep the voice iframe off that page.
    if (document.body.dataset.disableAiAssistant !== "true") {
      injectAIVoiceModal();
    }

    // 4. Initialize Lucide Icons
    loadLucide();
  }

  function injectAIVoiceModal() {
    if (document.getElementById("aiVoiceModal")) return;

    const modal = document.createElement("div");
    modal.id = "aiVoiceModal";
    modal.className = "driver-modal-scrim";
    modal.innerHTML = `
      <div class="driver-modal-sheet" style="text-align:center;">
        <div class="modal-drag-handle"></div>
        <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#4F46E5);color:#fff;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;box-shadow:0 8px 24px rgba(124,58,237,0.35);">
          <i data-lucide="bot" style="width:32px;height:32px;"></i>
        </div>
        <h2 style="font-size:18px;margin-bottom:4px;">FarmLink AI वॉइस सारथी</h2>
        <p style="font-size:13px;color:var(--ink-soft);margin-bottom:16px;">
          सक्रिय ट्रिप, मौसम चेतावनी और AI शॉर्टेस्ट रूट की बोलकर जानकारी सुनें
        </p>

        <div style="background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-lg);padding:10px;text-align:left;margin-bottom:16px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#7C3AED;animation:pulse-green 1.5s infinite;"></span>
            <strong style="font-size:12.5px;color:#7C3AED;">लाइव AI ट्रिप ब्रीफिंग:</strong>
          </div>
          <p role="status" style="margin:0;padding:16px;text-align:center;color:var(--ink-soft);font-size:13px;">
            वॉइस सहायक सुरक्षा कारणों से अस्थायी रूप से बंद है। व्यवस्थापक से सुरक्षित सेटअप के लिए संपर्क करें।
          </p>
        </div>

        <div style="display:flex;gap:10px;">
          <button type="button" class="btn btn-secondary" id="btnCloseAiModal" style="flex:0 0 80px;">
            बंद करें
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Event handlers
    document.addEventListener("click", (e) => {
      if (e.target.closest("#btnOpenAiAssistant")) {
        modal.classList.add("open");
        loadLucide();
      }
      if (e.target.closest("#btnCloseAiModal") || e.target === modal) {
        modal.classList.remove("open");
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      }
    });
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "driver-toast";
    toast.innerHTML = `<i data-lucide="check-circle" style="width:16px;height:16px;color:var(--lime);"></i> <span>${message}</span>`;
    document.body.appendChild(toast);
    loadLucide();

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 2800);
  }

  function loadLucide() {
    if (window.lucide) {
      window.lucide.createIcons();
    } else {
      const s = document.createElement("script");
      s.src = "https://unpkg.com/lucide@latest";
      s.onload = () => {
        if (window.lucide) window.lucide.createIcons();
      };
      document.head.appendChild(s);
    }
  }

  window.driverShell = {
    init: initDriverShell,
    showToast: showToast,
    refreshIcons: loadLucide,
  };
})();
