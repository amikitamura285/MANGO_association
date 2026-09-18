const $ = (selector) => document.querySelector(selector);
const state = {
  groups: [],
  products: [],
  checked: new Set(JSON.parse(localStorage.getItem("mango-monitor-checked") || "[]"))
};
let productsReady;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function normalizeName(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstDigit(value) {
  return String(value || "").match(/\d/)?.[0] || "";
}

function buildProductGroups(products) {
  const groups = new Map();
  for (const product of products || []) {
    const key = `${normalizeName(product.englishKey || product.name)}\u0000${firstDigit(product.brandItemNumber || product.brandItemFirstDigit || product.productNumber)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(product);
  }
  return [...groups.values()]
    .filter((items) => items.length > 1)
    .map((items) => ({
      englishKey: items[0].englishKey || normalizeName(items[0].name),
      main: items[0],
      related: items.slice(1)
    }));
}

function getJapanUrl(product) {
  if (product.japanUrl) return product.japanUrl;
  const query = product.productNumber || product.baseCode || product.globalCode;
  return query ? `https://japan.mango.com/search/?searchWord=${encodeURIComponent(query)}` : "";
}

function renderProductCards(containerSelector, groups, compact) {
  const container = $(containerSelector);
  if (!container) return;

  const renderImage = (product, small) => {
    const globalUrl = product.globalUrl || product.url || "";
    const japanUrl = compact ? getJapanUrl(product) : "";
    return `
    <a class="card-link" href="${globalUrl || japanUrl || "#"}" target="_blank" rel="noreferrer">
      <img class="${small ? "card-image-small" : "card-image"}" src="${product.image || ""}" alt="${escapeHtml(product.name || "MANGO product")}" loading="lazy">
      <div class="card-info">
        <h3 class="card-name">${escapeHtml(product.name || "MANGO")}</h3>
        <div class="card-number">
          <span>${escapeHtml(product.productNumber || product.baseCode || product.globalCode || "PRODUCT")}</span>
          <span>↗</span>
        </div>
      </div>
    </a>
    ${compact ? `<div class="card-destinations">
      ${globalUrl ? `<a href="${globalUrl}" target="_blank" rel="noreferrer">GLOBAL ↗</a>` : ""}
      ${japanUrl ? `<a href="${japanUrl}" target="_blank" rel="noreferrer">JP ↗</a>` : ""}
    </div>` : ""}
  `;
  };

  container.innerHTML = groups.map((group) => {
    const main = group.main || group.japanese || group;
    const related = Array.isArray(group.related) ? group.related : (Array.isArray(group.global) ? group.global : []);
    const isChecked = state.checked.has(main.productNumber);

    return `
      <section class="product-group">
        <article class="card card-main">
          ${renderImage(main, false)}
          <label class="check-toggle">
            <input type="checkbox" data-product-number="${escapeHtml(main.productNumber || "")}" ${isChecked ? "checked" : ""}>
            <span>確認済</span>
          </label>
        </article>
        ${related.length ? `<div class="related-items">${related.map((product) => `<article class="card card-related">${renderImage(product, true)}</article>`).join("")}</div>` : ""}
      </section>
    `;
  }).join("");

  container.classList.toggle("compact", Boolean(compact));

  document.querySelectorAll("[data-product-number]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const target = event.target;
      const productNumber = target.dataset.productNumber;
      if (!productNumber) return;
      if (target.checked) {
        state.checked.add(productNumber);
      } else {
        state.checked.delete(productNumber);
      }
      localStorage.setItem("mango-monitor-checked", JSON.stringify([...state.checked]));
      renderMainProducts();
    });
  });
}

function renderMainProducts() {
  const activeGroups = state.groups.filter((group) => !state.checked.has(group.main.productNumber));
  const checkedGroups = state.groups.filter((group) => state.checked.has(group.main.productNumber));

  renderProductCards("#productGrid", activeGroups, false);
  renderProductCards("#checkedProductGrid", checkedGroups, false);
  $("#productEmpty").hidden = activeGroups.length > 0;
  $("#checkedEmpty").hidden = checkedGroups.length > 0;
  $("#productCount").textContent = String(activeGroups.length).padStart(2, "0");
}

function loadProducts() {
  productsReady = fetch(`products.json?v=${Date.now()}`, { cache: "no-store" })
    .then((response) => response.json())
    .then((data) => {
      const groups = buildProductGroups(data.products || []);
      state.products = data.products || [];
      state.groups = groups;
      renderMainProducts();
      $("#updatedAt").textContent = data.updatedAt ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(data.updatedAt)) : "—";
      $("#scannedCount").textContent = data.scanned ? `${data.scanned} ITEMS SCANNED` : "";
    })
    .catch(() => {
      $("#productEmpty").hidden = false;
    });
  return productsReady;
}

function loadGlobalProducts() {
  const ready = productsReady || Promise.resolve();
  ready.then(() => fetch(`global-products.json?v=${Date.now()}`, { cache: "no-store" }))
    .then((response) => response.json())
    .then((data) => {
      let rows = [];

      rows = (Array.isArray(data.matches) ? data.matches : [])
        .map((entry) => ({
          main: entry.main,
          related: entry.relatedGlobal || []
        }))
        .filter((entry) => entry.main && entry.related.length > 0);

      $("#globalProductCount").textContent = String(rows.length).padStart(2, "0");
      $("#globalUpdatedAt").textContent = data.updatedAt ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(data.updatedAt)) : "—";
      $("#globalScannedCount").textContent = (data.products || []).length ? `${(data.products || []).length} GLOBAL PRODUCTS` : "";
      renderProductCards("#globalProductGrid", rows, true);
      $("#globalProductEmpty").hidden = rows.length > 0;
    })
    .catch(() => {
      $("#globalProductEmpty").hidden = false;
    });
}

function switchTab(targetView) {
  document.querySelectorAll(".relation-view").forEach((view) => {
    view.hidden = true;
  });
  document.querySelectorAll(".main-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === targetView);
  });
  const target = document.getElementById(targetView);
  if (target) target.hidden = false;

  if (targetView === "globalRelationView" && !window.globalRelationLoaded) {
    window.globalRelationLoaded = true;
    loadGlobalProducts();
  }
}

document.querySelectorAll(".main-tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.view));
});

window.addEventListener("DOMContentLoaded", () => {
  loadProducts();
  switchTab("relationView");
});
