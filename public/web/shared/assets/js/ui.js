/* Farmlink UI Interactions */

document.addEventListener("DOMContentLoaded", () => {
    // 1. Navigation Shell - Drawer & Highlight Setup
    initMobileDrawer();
    highlightActiveLinks();

    // 2. Specialized Page Logic Initialization
    initOtpFocus();
    initBankTabs();
    initAccordions();
});

/**
 * Mobile Navigation Drawer Toggle Handler
 */
function initMobileDrawer() {
    const toggleBtns = document.querySelectorAll(".drawer-toggle-btn");
    const drawer = document.querySelector(".sidebar-drawer");
    
    if (!drawer) return;

    // Create overlay element if it doesn't exist
    let overlay = document.querySelector(".drawer-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "drawer-overlay";
        document.body.appendChild(overlay);
    }

    // Toggle drawer functions
    const openDrawer = () => {
        drawer.classList.add("drawer-active");
        overlay.classList.add("overlay-active");
        document.body.style.overflow = "hidden"; // Prevent body scroll when drawer open
    };

    const closeDrawer = () => {
        drawer.classList.remove("drawer-active");
        overlay.classList.remove("overlay-active");
        document.body.style.overflow = "";
    };

    // Attach click listeners to hamburger toggles
    toggleBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            if (drawer.classList.contains("drawer-active")) {
                closeDrawer();
            } else {
                openDrawer();
            }
        });
    });

    // Close when overlay is clicked
    overlay.addEventListener("click", closeDrawer);

    // Close on escape key
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && drawer.classList.contains("drawer-active")) {
            closeDrawer();
        }
    });
}

/**
 * Highlight active page links in Sidebar and Bottom Navigation
 */
function highlightActiveLinks() {
    const currentPath = window.location.pathname;
    let pageName = currentPath.substring(currentPath.lastIndexOf("/") + 1);
    
    // Default fallback
    if (!pageName || pageName === "index.html") {
        pageName = "seller-dashboard.html";
    }

    // Highlight sidebar links
    const sidebarLinks = document.querySelectorAll(".sidebar-link");
    sidebarLinks.forEach(link => {
        const linkHref = link.getAttribute("href");
        if (linkHref && pageName.includes(linkHref)) {
            link.classList.add("sidebar-active");
        } else {
            link.classList.remove("sidebar-active");
        }
    });

    // Highlight mobile bottom navigation links
    const bottomLinks = document.querySelectorAll(".bottom-nav-link");
    bottomLinks.forEach(link => {
        const linkHref = link.getAttribute("href");
        if (linkHref && pageName.includes(linkHref)) {
            link.classList.add("bottom-active");
        } else {
            link.classList.remove("bottom-active");
        }
    });
}

/**
 * OTP Code input fields automatic cursor flow
 */
function initOtpFocus() {
    const otpInputs = document.querySelectorAll(".otp-input");
    if (otpInputs.length === 0) return;

    otpInputs.forEach((input, index) => {
        // Clear value on focus to make entry easier
        input.addEventListener("focus", () => {
            input.select();
        });

        input.addEventListener("input", (e) => {
            const val = e.target.value;
            // Only numbers allowed
            if (val && !/^[0-9]$/.test(val)) {
                e.target.value = "";
                return;
            }

            if (val.length === 1 && index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            }
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !e.target.value && index > 0) {
                otpInputs[index - 1].focus();
            }
        });
    });
}

/**
 * Bank Details Verification Tabs Switcher
 */
function initBankTabs() {
    const tabBtns = document.querySelectorAll(".tab-btn");
    const upiForm = document.getElementById("upi-form-panel");
    const bankForm = document.getElementById("bank-form-panel");

    if (tabBtns.length === 0) return;

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            // Remove active classes
            tabBtns.forEach(b => b.classList.remove("tab-active"));
            btn.classList.add("tab-active");

            const isUpi = btn.getAttribute("data-tab") === "upi";

            if (isUpi) {
                if (upiForm) {
                    upiForm.classList.remove("hidden");
                    // Enable inputs to participate in submission validation
                    upiForm.querySelectorAll("input").forEach(i => i.disabled = false);
                }
                if (bankForm) {
                    bankForm.classList.add("hidden");
                    bankForm.querySelectorAll("input").forEach(i => i.disabled = true);
                }
            } else {
                if (upiForm) {
                    upiForm.classList.add("hidden");
                    upiForm.querySelectorAll("input").forEach(i => i.disabled = true);
                }
                if (bankForm) {
                    bankForm.classList.remove("hidden");
                    bankForm.querySelectorAll("input").forEach(i => i.disabled = false);
                }
            }
        });
    });
}

/**
 * FAQ Collapsible Accordions for Help Center page
 */
function initAccordions() {
    const accordions = document.querySelectorAll(".accordion-trigger");
    if (accordions.length === 0) return;

    accordions.forEach(trigger => {
        trigger.addEventListener("click", () => {
            const item = trigger.closest(".accordion-item");
            const content = item.querySelector(".accordion-content");
            const isActive = item.classList.contains("active");

            // Close all other items in the same accordion group if desired
            const accordionGroup = trigger.closest(".accordion");
            if (accordionGroup) {
                accordionGroup.querySelectorAll(".accordion-item").forEach(otherItem => {
                    if (otherItem !== item) {
                        otherItem.classList.remove("active");
                        const otherContent = otherItem.querySelector(".accordion-content");
                        if (otherContent) otherContent.style.maxHeight = null;
                    }
                });
            }

            // Toggle active state
            if (isActive) {
                item.classList.remove("active");
                content.style.maxHeight = null;
            } else {
                item.classList.add("active");
                content.style.maxHeight = content.scrollHeight + "px";
            }
        });
    });
}
