// Apps Script (apps-script/Code.gs) をウェブアプリとしてデプロイしたURL(…/exec)。UPDATEと全員共通の確認済で使う
const GLOBAL_RELAY_URL = "https://script.google.com/macros/s/AKfycbxqxYvg2SIIEoEsvY4I0Ehly-eD_B3Thmu5PQvstHRFerVDgUOlievb-AsPgjDjlrCuxQ/exec";
const $ = (selector) => document.querySelector(selector);
const state = {
  groups: [],
  products: [],
  checked: new Set(),
  globalChecked: new Set(),
  globalRows: []
};
let productsReady;
const dataPathPrefix = /\/(?:relation|global|resize)\/$/.test(window.location.pathname) ? "../" : "";

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
        saveChecked("global", productNumber, target.checked);
      } else {
        renderMainProducts();
        saveChecked("relation", productNumber, target.checked);
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
      state.productsUpdatedAt = data.updatedAt || "";
      renderMainProducts();
      $("#updatedAt").textContent = data.updatedAt ? new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(data.updatedAt)) : "—";
      $("#scannedCount").textContent = data.scanned ? `${data.scanned} ITEMS SCANNED` : "";
    })
    .then(() => true)
    .catch(() => {
      if (!state.groups.length) $("#productEmpty").hidden = false;
      return false;
    });
  return productsReady;
}

const refreshButton = $("#productRefresh");
if (refreshButton) {
  const REFRESH_POLL_MS = 30000;
  const REFRESH_TIMEOUT_MS = 25 * 60 * 1000;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fetchUpdatedAt = async () => {
    try {
      const response = await fetch(`${dataPathPrefix}products.json?v=${Date.now()}`, { cache: "no-store" });
      return (await response.json()).updatedAt || "";
    } catch (error) {
      return "";
    }
  };
  const setRefreshLabel = (text) => { refreshButton.textContent = text; };

  refreshButton.addEventListener("click", async () => {
    refreshButton.disabled = true;
    setRefreshLabel("開始中…");
    let label = "UPDATED";
    try {
      const before = state.productsUpdatedAt || await fetchUpdatedAt();
      const response = await fetch(GLOBAL_RELAY_URL, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "crawl" }) });
      const body = await response.json();
      if (!body.ok) throw new Error(body.error || "更新を開始できませんでした。");
      const startedAt = Date.now();
      let updated = false;
      while (Date.now() - startedAt < REFRESH_TIMEOUT_MS) {
        const minutes = Math.floor((Date.now() - startedAt) / 60000);
        setRefreshLabel(`更新中 ${minutes}分`);
        await sleep(REFRESH_POLL_MS);
        const latest = await fetchUpdatedAt();
        if (latest && latest !== before) { updated = true; break; }
      }
      if (!updated) throw new Error("更新が終わるまで時間がかかっています。しばらくしてからもう一度UPDATEを押してください。");
      await loadProducts();
    } catch (error) {
      label = "失敗しました";
      alert(error.message);
    }
    setRefreshLabel(label);
    setTimeout(() => {
      setRefreshLabel("UPDATE");
      refreshButton.disabled = false;
    }, 2000);
  });
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

async function relayChecked(scope, request) {
  const response = request
    ? await fetch(GLOBAL_RELAY_URL, { method: "POST", headers: { "content-type": "text/plain;charset=utf-8" }, body: JSON.stringify({ ...request, scope }) })
    : await fetch(`${GLOBAL_RELAY_URL}?action=checked&scope=${scope}&v=${Date.now()}`, { cache: "no-store" });
  const body = await response.json();
  if (!body.ok) throw new Error(body.error || "確認済を取得できませんでした。");
  return body.checked || [];
}

const CHECKED_VIEWS = {
  global: { stateKey: "globalChecked", render: () => renderGlobalRows() },
  relation: { stateKey: "checked", render: () => renderMainProducts() }
};

// 保存の完了待ちの間に、古い読み込み結果で画面が戻らないよう、押した直後の状態を重ねて表示する
const pendingChecks = { global: new Map(), relation: new Map() };
const checkedSeq = { global: { started: 0, applied: 0 }, relation: { started: 0, applied: 0 } };

function applyChecked(scope, list, seq) {
  const tracker = checkedSeq[scope];
  if (seq < tracker.applied) return;
  tracker.applied = seq;
  const set = new Set(list);
  for (const [code, checked] of pendingChecks[scope]) {
    if (checked) set.add(code); else set.delete(code);
  }
  state[CHECKED_VIEWS[scope].stateKey] = set;
  CHECKED_VIEWS[scope].render();
}

async function loadChecked(scope) {
  const seq = ++checkedSeq[scope].started;
  try {
    let list = await relayChecked(scope);
    if (scope === "relation") {
      // 以前このブラウザだけに保存していた確認済を、一度だけ共有側へ移す
      const legacy = JSON.parse(localStorage.getItem("mango-monitor-checked") || "[]").filter((code) => /^[A-Za-z0-9]{6,20}$/.test(code));
      if (legacy.length) {
        list = await relayChecked(scope, { action: "check", productNumbers: legacy.slice(-450), checked: true });
        localStorage.removeItem("mango-monitor-checked");
      }
    }
    applyChecked(scope, list, seq);
  } catch (error) {
    console.warn("確認済を読み込めませんでした:", error.message);
  }
}

async function saveChecked(scope, productNumber, checked) {
  const pending = pendingChecks[scope];
  pending.set(productNumber, checked);
  const seq = ++checkedSeq[scope].started;
  try {
    const list = await relayChecked(scope, { action: "check", productNumber, checked });
    if (pending.get(productNumber) === checked) pending.delete(productNumber);
    applyChecked(scope, list, seq);
  } catch (error) {
    if (pending.get(productNumber) === checked) pending.delete(productNumber);
    const set = state[CHECKED_VIEWS[scope].stateKey];
    if (checked) set.delete(productNumber); else set.add(productNumber);
    CHECKED_VIEWS[scope].render();
    alert(`確認済の保存に失敗しました。もう一度お試しください。(${error.message})`);
  }
}

function watchChecked() {
  const reload = () => { loadChecked("global"); loadChecked("relation"); };
  reload();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) reload(); });
}

function loadGlobalProducts() {
  const ready = productsReady || Promise.resolve();
  ready.then(() => fetch(`${dataPathPrefix}global-products.json?v=${Date.now()}`, { cache: "no-store" }))
    .then((response) => response.json())
    .then(renderGlobalData)
    .catch(() => {
      $("#globalProductEmpty").hidden = false;
    });
}

function routeForView(targetView) {
  const route = { globalRelationView: "global", resizeView: "resize" }[targetView] || "relation";
  const path = window.location.pathname;
  const base = path.replace(/(?:relation|global|resize)\/?$/, "").replace(/\/?$/, "/");
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

function viewForPath(path) {
  if (path.includes("/global/")) return "globalRelationView";
  if (path.includes("/resize/")) return "resizeView";
  return "relationView";
}

window.addEventListener("popstate", () => switchTab(viewForPath(window.location.pathname)));

window.addEventListener("DOMContentLoaded", () => {
  loadProducts();
  watchChecked();
  switchTab(viewForPath(window.location.pathname));
});
