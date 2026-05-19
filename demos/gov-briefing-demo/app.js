// ---------------------------------------------------------------------------
// Data — in a real classified .uix this comes from the encrypted data.db
// via window.__uix.data.find(). Here we use static data for the demo build.
// ---------------------------------------------------------------------------

const THREATS = [
  {
    name: "Perimeter Sensor Grid",
    level: "HIGH",
    desc: "Three nodes reported offline since 12 May. Replacement parts in transit.",
  },
  {
    name: "Digital Comms Channel B",
    level: "HIGH",
    desc: "Encryption key rotation overdue by 14 days. Escalation pending.",
  },
  {
    name: "Vehicle Access Control",
    level: "MEDIUM",
    desc: "RFID reader at Gate 4 reporting intermittent failures.",
  },
  {
    name: "Staff ID System",
    level: "MEDIUM",
    desc: "Legacy biometric readers flagged for upgrade in H2 2026.",
  },
  {
    name: "Backup Power (East)",
    level: "LOW",
    desc: "Generator test scheduled for 22 May. No action required.",
  },
  {
    name: "Visitor Management",
    level: "LOW",
    desc: "System operating normally. Last audit: 01 May 2026.",
  },
];

const ASSETS = [
  { code: "AST-001", name: "Primary Operations Center", status: "SECURE" },
  {
    code: "AST-002",
    name: "Eastern Perimeter Communications",
    status: "REVIEW",
  },
  {
    code: "AST-003",
    name: "Underground Fiber Network (Zone C)",
    status: "SECURE",
  },
  { code: "AST-004", name: "Emergency Broadcast Relay", status: "CRITICAL" },
  {
    code: "AST-005",
    name: "Backup Command Node (Classified)",
    status: "SECURE",
  },
  { code: "AST-006", name: "Central Data Repository", status: "REVIEW" },
];

const RECOMMENDATIONS = [
  "Immediately rotate encryption keys on Digital Comms Channel B — deadline 24 May 2026.",
  "Dispatch field engineer to replace offline Perimeter Sensor Grid nodes (Gate 7, 11, 19).",
  "Initiate Emergency Broadcast Relay restoration protocol per SOP-INFRA-034.",
  "Conduct unannounced security audit of Vehicle Access Control at all gates before 31 May.",
  "Accelerate H2 2026 biometric upgrade timeline — prioritize high-traffic entry points.",
  "All personnel with access to this document to confirm receipt via secure channel within 48 hours.",
];

const CONTACTS = [
  {
    role: "Document Owner",
    name: "Director, Operations",
    channel: "SEC-CHAN-A // CLASSIFIED",
  },
  {
    role: "Primary Contact",
    name: "Head of Infrastructure",
    channel: "SEC-CHAN-B // RESTRICTED",
  },
  {
    role: "Security Liaison",
    name: "Senior Analyst, Cyber Ops",
    channel: "SEC-CHAN-C // RESTRICTED",
  },
  {
    role: "Escalation — Urgent",
    name: "Deputy Minister, Interior",
    channel: "SEC-CHAN-A // PRIORITY",
  },
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderThreatGrid() {
  const el = document.getElementById("threat-grid");
  if (!el) return;
  el.innerHTML = THREATS.map(
    (t) => `
    <div class="threat-card">
      <div class="threat-name">${t.name}</div>
      <div class="threat-level ${t.level}">${t.level}</div>
      <div class="threat-desc">${t.desc}</div>
    </div>
  `,
  ).join("");
}

function renderAssets() {
  const el = document.getElementById("asset-list");
  if (!el) return;
  el.innerHTML = ASSETS.map(
    (a) => `
    <div class="asset-row">
      <span class="asset-code">${a.code}</span>
      <span class="asset-name">${a.name}</span>
      <span class="asset-status ${a.status}">${a.status}</span>
    </div>
  `,
  ).join("");
}

function renderRecommendations() {
  const el = document.getElementById("rec-list");
  if (!el) return;
  el.innerHTML = RECOMMENDATIONS.map((r) => `<li>${r}</li>`).join("");
}

function renderContacts() {
  const el = document.getElementById("contact-grid");
  if (!el) return;
  el.innerHTML = CONTACTS.map(
    (c) => `
    <div class="contact-card">
      <div class="contact-role">${c.role}</div>
      <div class="contact-name">${c.name}</div>
      <div class="contact-channel">${c.channel}</div>
    </div>
  `,
  ).join("");
}

function updateSignatureStatus() {
  const el = document.getElementById("sig-status");
  if (!el) return;
  // In the real viewer, window.__uix.manifest() returns the verified signature state.
  // Here we simulate the verified state for the demo.
  if (window.uix) {
    window.uix
      .manifest()
      .then((m) => {
        if (m && m.signature) {
          el.textContent = "✓ Ed25519 Verified";
          el.className = "meta-value verified";
        } else {
          el.textContent = "Not signed";
          el.className = "meta-value";
        }
      })
      .catch(() => {
        el.textContent = "✓ Ed25519 Verified (demo)";
        el.className = "meta-value verified";
      });
  } else {
    el.textContent = "✓ Ed25519 Verified (demo)";
    el.className = "meta-value verified";
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function initNav() {
  const buttons = document.querySelectorAll(".nav-btn");
  const sections = document.querySelectorAll(".doc-section");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.section;
      buttons.forEach((b) => b.classList.remove("active"));
      sections.forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`section-${target}`)?.classList.add("active");
    });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  renderThreatGrid();
  renderAssets();
  renderRecommendations();
  renderContacts();
  updateSignatureStatus();
  initNav();
});
