/**
 * fix-uix.mjs
 * Diagnose and fix a GPT-generated .uix that has wrong API usage and no data.db.
 *
 * Usage: node scripts/fix-uix.mjs <path-to-file.uix>
 */
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import AdmZip from "adm-zip";
import { UIX, createDataDb } from "@dotuix/core";

const uixPath = process.argv[2];
if (!uixPath) {
  console.error("Usage: node scripts/fix-uix.mjs <path-to-file.uix>");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Unzip and read files
// ---------------------------------------------------------------------------
const zip = new AdmZip(uixPath);
const entries = zip.getEntries().map((e) => e.entryName);
console.log("Files in archive:", entries);

function readEntry(name) {
  const e = zip.getEntry(name);
  return e ? e.getData() : null;
}

const manifestBuf = readEntry("manifest.json");
const appJsBuf = readEntry("app.js");
const dataRecordsBuf = readEntry("dataRecords.json");
const hasDataDb = entries.includes("data.db");

console.log({ hasDataDb, hasDataRecordsJson: !!dataRecordsBuf });

if (!dataRecordsBuf) {
  console.error("No dataRecords.json found — don't know how to seed data.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Convert dataRecords.json → flat records array for createDataDb
// ---------------------------------------------------------------------------
const raw = JSON.parse(dataRecordsBuf.toString("utf8"));

const records = [];

// categories
if (Array.isArray(raw.categories)) {
  for (const cat of raw.categories) {
    records.push({ id: `category:${cat.id}`, type: "category", body: cat });
  }
}

// menuItems
if (Array.isArray(raw.menuItems)) {
  for (const item of raw.menuItems) {
    records.push({ id: `menuItem:${item.id}`, type: "menuItem", body: item });
  }
}

// i18n — store as a single record per language
if (raw.i18n && typeof raw.i18n === "object") {
  for (const [lang, strings] of Object.entries(raw.i18n)) {
    records.push({
      id: `i18n:${lang}`,
      type: "i18n",
      body: { lang, ...strings },
    });
  }
}

console.log(`Creating data.db with ${records.length} records…`);
const dataDbBytes = await createDataDb(records);

// ---------------------------------------------------------------------------
// 3. Rewrite app.js with correct bridge API
// ---------------------------------------------------------------------------
const fixedAppJs = `const uix = window.__uix || window.uix;

let currentLang = "en";
let activeCategory = null;
let cart = {};

async function init() {
  // Fetch all data using the correct bridge API
  const [catRecords, itemRecords, i18nRecords] = await Promise.all([
    uix.data.find({ type: "category", orderBy: "sort" }),
    uix.data.find({ type: "menuItem" }),
    uix.data.find({ type: "i18n" }),
  ]);

  // body is always a JSON string — must JSON.parse
  const categories = catRecords
    .map((r) => (typeof r.body === "string" ? JSON.parse(r.body) : r.body))
    .sort((a, b) => a.sort - b.sort);

  const menuItems = itemRecords.map((r) =>
    typeof r.body === "string" ? JSON.parse(r.body) : r.body
  );

  // Rebuild i18n object from individual records
  const strings = {};
  for (const r of i18nRecords) {
    const b = typeof r.body === "string" ? JSON.parse(r.body) : r.body;
    const { lang, ...rest } = b;
    strings[lang] = rest;
  }

  activeCategory = categories[0]?.id ?? null;

  render(categories, menuItems, strings);
}

function render(categories, menuItems, strings) {
  const t = strings[currentLang] ?? {};

  document.body.dir = currentLang === "ar" ? "rtl" : "ltr";

  const filtered = menuItems.filter(
    (item) => item.category === activeCategory
  );

  const totalQty = Object.values(cart).reduce((a, b) => a + b, 0);

  const totalPrice = menuItems.reduce((sum, item) => {
    return sum + (cart[item.id] || 0) * item.price;
  }, 0);

  document.getElementById("app").innerHTML = \`
    <header class="topbar">
      <h1>\${t.restaurant ?? ""}</h1>
      <button class="lang-btn" id="langBtn">\${t.langBtn ?? ""}</button>
    </header>

    <section class="categories">
      \${categories
        .map(
          (cat) => \`
        <button class="cat-btn \${activeCategory === cat.id ? "active" : ""}" data-cat="\${cat.id}">
          \${currentLang === "ar" ? cat.nameAr : cat.nameEn}
        </button>\`
        )
        .join("")}
    </section>

    <main class="content">
      <section class="menu-grid">
        \${filtered
          .map(
            (item) => \`
          <div class="card">
            <div class="emoji">\${item.emoji ?? ""}</div>
            <div class="title">\${currentLang === "ar" ? item.nameAr : item.nameEn}</div>
            <div class="desc">\${currentLang === "ar" ? item.descAr : item.descEn}</div>
            \${item.badge ? \`<div class="badge">\${item.badge}</div>\` : ""}
            <div class="bottom">
              <div class="price">\${item.price} \${item.currency}</div>
              <button class="add-btn" data-id="\${item.id}">\${t.add ?? "+"}</button>
            </div>
          </div>\`
          )
          .join("")}
      </section>

      <aside class="cart">
        <h2>\${t.yourOrder ?? "Order"}</h2>
        <div class="cart-items">
          \${
            totalQty === 0
              ? \`<p>\${t.emptyCart ?? ""}</p>\`
              : menuItems
                  .filter((item) => cart[item.id])
                  .map(
                    (item) => \`
                  <div class="cart-item">
                    <span>\${currentLang === "ar" ? item.nameAr : item.nameEn}</span>
                    <span>x\${cart[item.id]}</span>
                  </div>\`
                  )
                  .join("")
          }
        </div>
        <div class="cart-total">\${t.total ?? "Total"}: \${totalPrice} QAR</div>
        <button class="checkout-btn" id="checkoutBtn">\${t.placeOrder ?? "Order"}</button>
      </aside>
    </main>
  \`;

  bindEvents(categories, menuItems, strings);
}

function bindEvents(categories, menuItems, strings) {
  document.querySelectorAll(".cat-btn").forEach((btn) => {
    btn.onclick = () => {
      activeCategory = btn.dataset.cat;
      render(categories, menuItems, strings);
    };
  });

  document.querySelectorAll(".add-btn").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      cart[id] = (cart[id] || 0) + 1;
      render(categories, menuItems, strings);
    };
  });

  document.getElementById("langBtn").onclick = () => {
    currentLang = currentLang === "en" ? "ar" : "en";
    render(categories, menuItems, strings);
  };

  document.getElementById("checkoutBtn").onclick = async () => {
    const orderId = Math.floor(Math.random() * 100000);
    alert((strings[currentLang]?.thankYou ?? "Thank you! Order #") + orderId);
    cart = {};
    render(categories, menuItems, strings);
  };
}

init().catch((err) => {
  console.error("dotuix app error:", err);
  document.getElementById("app").innerHTML =
    \`<p style="color:red;padding:2rem">Error loading app: \${err.message}</p>\`;
});
`;

// ---------------------------------------------------------------------------
// 4. Build the fixed .uix (zip)
// ---------------------------------------------------------------------------
const fixedZip = new AdmZip();

for (const entry of zip.getEntries()) {
  const name = entry.entryName;
  if (name === "app.js") continue; // replaced below
  if (name === "dataRecords.json") continue; // replaced by data.db
  if (name === "data.db") continue; // replaced below
  fixedZip.addFile(name, entry.getData());
}

fixedZip.addFile("app.js", Buffer.from(fixedAppJs, "utf8"));
fixedZip.addFile("data.db", Buffer.from(dataDbBytes));

const outPath = join(
  dirname(uixPath),
  basename(uixPath, ".uix") + "-fixed.uix",
);
fixedZip.writeZip(outPath);
console.log(`\nFixed .uix written to: ${outPath}`);
console.log("Changes made:");
console.log("  ✓ Removed dataRecords.json");
console.log("  ✓ Created data.db with", records.length, "records");
console.log("  ✓ Rewrote app.js: uix.data.getAll() → uix.data.find({ type })");
console.log("  ✓ Added JSON.parse(record.body) for all records");
