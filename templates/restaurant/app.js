/**
 * Restaurant template — app.js
 *
 * Uses the window.__uix bridge injected by the dotuix viewer.
 * When the bridge is absent (plain browser preview), falls back to DEMO_DATA.
 */

// ---------------------------------------------------------------------------
// Demo data — replaces live DB when running outside a viewer
// ---------------------------------------------------------------------------
const DEMO_DATA = [
  {
    id: "p1",
    type: "product",
    body: JSON.stringify({
      name: "مندي الدجاج",
      description: "دجاج مطهو ببطء مع الأرز البسمتي والتوابل اليمنية",
      price: 45,
      category: "رئيسية",
      image: null,
    }),
  },
  {
    id: "p2",
    type: "product",
    body: JSON.stringify({
      name: "كبسة اللحم",
      description: "لحم ضأن طازج مع أرز بسمتي مُتبَّل بالزعفران",
      price: 65,
      category: "رئيسية",
    }),
  },
  {
    id: "p3",
    type: "product",
    body: JSON.stringify({
      name: "سلطة فتوش",
      description: "خضروات طازجة مع خبز محمص وصلصة الرمان",
      price: 18,
      category: "مقبلات",
    }),
  },
  {
    id: "p4",
    type: "product",
    body: JSON.stringify({
      name: "حمص بالطحينة",
      description: "حمص كريمي مع زيت الزيتون والبابريكا",
      price: 15,
      category: "مقبلات",
    }),
  },
  {
    id: "p5",
    type: "product",
    body: JSON.stringify({
      name: "عصير المانجو",
      description: "مانجو طازجة معصورة",
      price: 14,
      category: "مشروبات",
    }),
  },
];

// ---------------------------------------------------------------------------
// Bridge setup
// ---------------------------------------------------------------------------
const bridge = window.__uix ?? null;

async function fetchProducts() {
  if (bridge) {
    const records = await bridge.data.find({ type: "product" });
    return records.map((r) => ({ ...r, body: JSON.parse(r.body) }));
  }
  return DEMO_DATA.map((r) => ({ ...r, body: JSON.parse(r.body) }));
}

// ---------------------------------------------------------------------------
// Cart state
// ---------------------------------------------------------------------------
const cart = []; // { product, qty }

function cartTotal() {
  return cart.reduce(
    (sum, item) => sum + item.product.body.price * item.qty,
    0,
  );
}

function addToCart(product) {
  const existing = cart.find((i) => i.product.id === product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ product, qty: 1 });
  }
  renderCart();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
let allProducts = [];
let activeCategory = null;

function renderCategories(products) {
  const cats = [...new Set(products.map((p) => p.body.category))];
  const nav = document.getElementById("categories");
  nav.innerHTML = "";

  for (const cat of cats) {
    const btn = document.createElement("button");
    btn.textContent = cat;
    if (activeCategory === cat) btn.classList.add("active");
    btn.addEventListener("click", () => {
      activeCategory = activeCategory === cat ? null : cat;
      renderCategories(allProducts);
      renderMenu(allProducts);
    });
    nav.appendChild(btn);
  }
}

function renderMenu(products) {
  const visible = activeCategory
    ? products.filter((p) => p.body.category === activeCategory)
    : products;

  const menu = document.getElementById("menu");
  menu.innerHTML = "";

  if (visible.length === 0) {
    menu.innerHTML = '<p class="empty">لا توجد عناصر</p>';
    return;
  }

  for (const product of visible) {
    const { name, description, price, image } = product.body;
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      ${image ? `<img src="${image}" alt="${name}" loading="lazy" />` : ""}
      <div class="info">
        <span class="name">${name}</span>
        <span class="desc">${description ?? ""}</span>
        <div class="footer">
          <span class="price">${price} ر.س</span>
          <button class="btn-add" data-id="${product.id}">أضف</button>
        </div>
      </div>
    `;
    card
      .querySelector(".btn-add")
      .addEventListener("click", () => addToCart(product));
    menu.appendChild(card);
  }
}

function renderCart() {
  const list = document.getElementById("cart-items");
  const total = document.getElementById("cart-total-price");

  list.innerHTML = "";
  for (const { product, qty } of cart) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${product.body.name} × ${qty}</span><span>${product.body.price * qty} ر.س</span>`;
    list.appendChild(li);
  }

  if (cart.length === 0) {
    list.innerHTML = '<li class="empty">السلة فارغة</li>';
  }

  total.textContent = `${cartTotal()} ر.س`;
}

async function handleOrder() {
  if (cart.length === 0) return;

  if (bridge) {
    await bridge.state.insert({
      type: "order",
      body: JSON.stringify({
        items: cart.map((i) => ({ productId: i.product.id, qty: i.qty })),
        total: cartTotal(),
        placedAt: new Date().toISOString(),
      }),
    });
  }

  // Reset cart
  cart.length = 0;
  renderCart();
  alert("تم إرسال طلبك بنجاح!");
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
(async () => {
  allProducts = await fetchProducts();
  renderCategories(allProducts);
  renderMenu(allProducts);
  renderCart();

  document.getElementById("btn-order").addEventListener("click", handleOrder);
})();
