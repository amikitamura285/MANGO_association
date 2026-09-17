const grid = document.querySelector("#productGrid");
const empty = document.querySelector("#emptyState");
const count = document.querySelector("#productCount");
const updated = document.querySelector("#updatedAt");
const scanned = document.querySelector("#scannedCount");
const status = document.querySelector("#crawlStatus");
const button = document.querySelector("#crawlButton");
const crawlFeedback = document.querySelector("#crawlFeedback");
const checkedStorageKey = "mango-finder-checked-main-products";
let currentData;

function readCheckedProducts() {
  const value = localStorage.getItem(checkedStorageKey);
  const productNumbers = JSON.parse(value || "[]");
  return new Set(Array.isArray(productNumbers) ? productNumbers : []);
}

function saveCheckedProducts(checkedProducts) {
  localStorage.setItem(checkedStorageKey, JSON.stringify([...checkedProducts]));
}

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function render(data) {
  currentData = data;
  const products = data.products || [];
  const sourceGroups = data.groups && data.groups.length ? data.groups : buildGroups(products);
  const checkedProducts = readCheckedProducts();
  const groups = sourceGroups.filter((group) => !checkedProducts.has(group.main.productNumber));
  const checkedGroups = sourceGroups.filter((group) => checkedProducts.has(group.main.productNumber));
  count.textContent = String(groups.length).padStart(2, "0");
  updated.textContent = formatDate(data.updatedAt);
  scanned.textContent = data.scanned ? `${data.scanned} PRODUCTS SCANNED` : "";
  const card = (product, small = false) => `
    <a class="card-link${small ? " card-link-small" : ""}" href="${product.url}" target="_blank" rel="noreferrer">
      <img class="${small ? "card-image-small" : "card-image"}" src="${product.image || "https://placehold.co/600x800/e8e6e1/777?text=MANGO"}" alt="${product.name}">
      <div class="card-info"><h3 class="card-name">${product.name}</h3><div class="card-number"><span>${product.productNumber || "PRODUCT"}</span><span>↗</span></div></div>
    </a>`;
  const groupMarkup = (group) => `
    <section class="product-group">
      <article class="card card-main">
        <label class="checked-toggle">
          <input type="checkbox" data-product-number="${group.main.productNumber}"${checkedProducts.has(group.main.productNumber) ? " checked" : ""}>
          <span>確認済</span>
        </label>
        ${card(group.main)}
      </article>
      ${group.related.length ? `<div class="related-items">${group.related.map((product) => `<article class="card card-related">${card(product, true)}</article>`).join("")}</div>` : ""}
    </section>`;
  grid.innerHTML = `
    ${groups.map(groupMarkup).join("")}
    ${checkedGroups.length ? `<h2 class="group-title confirmed-title">確認済</h2>${checkedGroups.map(groupMarkup).join("")}` : ""}`;
  empty.hidden = groups.length !== 0 || checkedGroups.length !== 0;
  grid.querySelectorAll(".checked-toggle input").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const nextCheckedProducts = readCheckedProducts();
      if (checkbox.checked) nextCheckedProducts.add(checkbox.dataset.productNumber);
      else nextCheckedProducts.delete(checkbox.dataset.productNumber);
      saveCheckedProducts(nextCheckedProducts);
      render(currentData);
    });
  });
}

function buildGroups(products) {
  const grouped = new Map();
  products.forEach((product) => {
    const firstDigit = (product.brandItemFirstDigit || product.brandItemNumber || "").match(/\d/)?.[0] || product.productNumber;
    const key = `${product.englishKey}\u0000${firstDigit}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(product);
  });
  return [...grouped.entries()]
    .map(([key, items]) => ({ englishKey: key.split("\u0000")[0], main: items[0], related: items.slice(1) }));
}

async function load() {
  const response = await fetch(`products.json?v=${Date.now()}`, { cache: "no-store" });
  render(await response.json());
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    if (data.status === "running") {
      status.textContent = "クロール中…";
      crawlFeedback.textContent = "クロール中です。完了までお待ちください。";
      button.textContent = "クロール中…";
    } else if (data.status === "error") {
      status.textContent = "クロールエラー";
      crawlFeedback.textContent = "クロールに失敗しました。";
      button.textContent = "今すぐクロール →";
    } else {
      status.textContent = "毎朝 04:00 自動更新";
      if (data.finishedAt && crawlFeedback.textContent.includes("クロール中")) {
        crawlFeedback.textContent = `クロール完了（${formatDate(data.finishedAt)}）`;
      }
      button.textContent = "今すぐクロール →";
    }
    button.disabled = data.status === "running";
    button.style.opacity = data.status === "running" ? ".5" : "1";
    if (data.status === "running") setTimeout(refreshStatus, 2000);
    else if (data.finishedAt) load();
  } catch {
    status.textContent = "毎朝 04:00 自動更新";
    button.disabled = true;
    button.title = "GitHub Actionsが毎朝自動更新します";
    button.style.opacity = ".5";
    crawlFeedback.textContent = "公開ページでは手動クロールを実行できません。毎朝4時に自動更新されます。";
  }
}

button.addEventListener("click", async () => {
  button.disabled = true;
  button.textContent = "開始しています…";
  crawlFeedback.textContent = "クロールを開始しました。";
  try {
    const response = await fetch("/api/crawl", { method: "POST" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    crawlFeedback.textContent = "このページからは手動クロールを実行できません。毎朝4時に自動更新されます。";
    button.textContent = "今すぐクロール →";
    button.disabled = true;
    return;
  }
  refreshStatus();
});
load().catch(() => { status.textContent = "データを読み込めません"; });
refreshStatus();
