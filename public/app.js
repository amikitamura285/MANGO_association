// Apps Script (apps-script/Code.gs) をウェブアプリとしてデプロイしたURL(…/exec)。UPDATEと全員共通の確認済で使う
const GLOBAL_RELAY_URL = "https://script.google.com/macros/s/AKfycbzlBAJ_d0QvYsEw88G4yQK0kldmlS1RpGBJ2E-SUtMA_UVIL9bKR2Gc9prXmECnb2d-/exec";
const $ = (selector) => document.querySelector(selector);
const state = {
  groups: [],
  products: [],
  checked: new Set(JSON.parse(localStorage.getItem("mango-monitor-checked") || "[]")),
  globalChecked: new Set(),
  globalRows: []
};
let productsReady;
const dataPathPrefix = /\/(?:relation|global)\/$/.test(window.location.pathname) ? "../" : "";

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
  return product.japanUrl || "";
}

function renderProductCards(containerSelector, groups, compact, scope = "main") {
  const container = $(containerSelector);
  if (!container) return;
  const checkedSet = scope === "global" ? state.globalChecked : state.checked;

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
    const isChecked = checkedSet.has(main.productNumber);

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

  container.querySelectorAll("[data-product-number]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const target = event.target;
      const productNumber = target.dataset.productNumber;
      if (!productNumber) return;
      if (target.checked) {
        checkedSet.add(productNumber);
      } else {
        checkedSet.delete(productNumber);
      }
      if (scope === "global") {
        renderGlobalRows();
        saveGlobalChecked(productNumber, target.checked);
      } else {
        localStorage.setItem("mango-monitor-checked", JSON.stringify([...checkedSet]));
        renderMainProducts();
      }
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
  productsReady = fetch(`${dataPathPrefix}products.json?v=${Date.now()}`, { cache: "no-store" })
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

function renderGlobalData(data) {
  const rows = (Array.isArray(data.matches) ? data.matches : [])
    .map((entry) => ({
      main: entry.main,
      related: entry.relatedGlobal || []
    }))
    .filter((entry) => entry.main && entry.related.length > 0);

  state.globalRows = rows;
  $("#globalUpdatedAt").textContent = data.updatedAt ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(data.updatedAt)) : "—";
  $("#globalScannedCount").textContent = (data.products || []).length ? `${(data.products || []).length} GLOBAL PRODUCTS` : "";
  renderGlobalRows();
}

function renderGlobalRows() {
  const rows = state.globalRows;
  const activeRows = rows.filter((row) => !state.globalChecked.has(row.main.productNumber));
  const checkedRows = rows.filter((row) => state.globalChecked.has(row.main.productNumber));
  $("#globalProductCount").textContent = String(activeRows.length).padStart(2, "0");
  renderProductCards("#globalProductGrid", activeRows, true, "global");
  renderProductCards("#globalCheckedProductGrid", checkedRows, true, "global");
  $("#globalProductEmpty").hidden = rows.length > 0;
  $("#globalCheckedEmpty").hidden = checkedRows.length > 0;
}

async function relayChecked(request) {
  const response = request
    ? await fetch(GLOBAL_RELAY_URL, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify(request) })
    : await fetch(`${GLOBAL_RELAY_URL}?action=checked&v=${Date.now()}`, { cache: "no-store" });
  const body = await response.json();
  if (!body.ok) throw new Error(body.error || "確認済を取得できませんでした。");
  return body.checked || [];
}

async function loadGlobalChecked() {
  try {
    state.globalChecked = new Set(await relayChecked());
    renderGlobalRows();
  } catch (error) {
    console.warn("確認済を読み込めませんでした:", error.message);
  }
}

async function saveGlobalChecked(productNumber, checked) {
  try {
    state.globalChecked = new Set(await relayChecked({ action: "check", productNumber, checked }));
  } catch (error) {
    if (checked) state.globalChecked.delete(productNumber); else state.globalChecked.add(productNumber);
    alert(`確認済の保存に失敗しました。もう一度お試しください。(${error.message})`);
  }
  renderGlobalRows();
}

function loadGlobalProducts() {
  loadGlobalChecked();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { loadGlobalChecked(); } });
  const ready = productsReady || Promise.resolve();
  ready.then(() => fetch(`${dataPathPrefix}global-products.json?v=${Date.now()}`, { cache: "no-store" }))
    .then((response) => response.json())
    .then(renderGlobalData)
    .catch(() => {
      $("#globalProductEmpty").hidden = false;
    });
}

function routeForView(targetView) {
  const route = targetView === "globalRelationView" ? "global" : "relation";
  const path = window.location.pathname;
  const base = path.replace(/(?:relation|global)\/?$/, "").replace(/\/?$/, "/");
  return `${base}${route}/`;
}

function switchTab(targetView, updateUrl = false) {
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
  if (updateUrl && window.location.protocol !== "file:") {
    window.history.pushState({ view: targetView }, "", routeForView(targetView));
  }
}

document.querySelectorAll(".main-tab").forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.view, true));
});

window.addEventListener("popstate", () => {
  switchTab(window.location.pathname.includes("/global/") ? "globalRelationView" : "relationView");
});

window.addEventListener("DOMContentLoaded", () => {
  loadProducts();
  const path = window.location.pathname;
  switchTab(path.includes("/global/") ? "globalRelationView" : "relationView");
});
