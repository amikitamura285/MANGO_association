const grid = document.querySelector("#productGrid");
const empty = document.querySelector("#emptyState");
const count = document.querySelector("#productCount");
const updated = document.querySelector("#updatedAt");
const scanned = document.querySelector("#scannedCount");
const status = document.querySelector("#crawlStatus");
const button = document.querySelector("#crawlButton");

function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function render(data) {
  const products = data.products || [];
  const groups = data.groups && data.groups.length ? data.groups : buildGroups(products);
  count.textContent = String(data.newCount ?? groups.length).padStart(2, "0");
  updated.textContent = formatDate(data.updatedAt);
  scanned.textContent = data.scanned ? `${data.scanned} PRODUCTS SCANNED` : "";
  const card = (product, small = false) => `
    <a class="card-link${small ? " card-link-small" : ""}" href="${product.url}" target="_blank" rel="noreferrer">
      <img class="${small ? "card-image-small" : "card-image"}" src="${product.image || "https://placehold.co/600x800/e8e6e1/777?text=MANGO"}" alt="${product.name}">
      <div class="card-info"><h3 class="card-name">${product.name}</h3><div class="card-number"><span>${product.productNumber || "PRODUCT"}</span><span>↗</span></div></div>
    </a>`;
  grid.innerHTML = groups.map((group) => `
    <section class="product-group">
      <article class="card card-main">${card(group.main)}</article>
      ${group.related.length ? `<div class="related-items">${group.related.map((product) => `<article class="card card-related">${card(product, true)}</article>`).join("")}</div>` : ""}
    </section>`).join("");
  empty.hidden = groups.length !== 0;
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
    status.textContent = data.status === "running" ? "クロール中…" : data.status === "error" ? "クロールエラー" : "毎朝 04:00 自動更新";
    button.disabled = data.status === "running";
    button.style.opacity = data.status === "running" ? ".5" : "1";
    if (data.status === "running") setTimeout(refreshStatus, 2000);
    else if (data.finishedAt) load();
  } catch {
    status.textContent = "毎朝 04:00 自動更新";
    button.disabled = true;
    button.title = "GitHub Actionsが毎朝自動更新します";
    button.style.opacity = ".5";
  }
}

button.addEventListener("click", async () => {
  try {
    await fetch("/api/crawl", { method: "POST" });
  } catch {
    return;
  }
  refreshStatus();
});
load().catch(() => { status.textContent = "データを読み込めません"; });
refreshStatus();
