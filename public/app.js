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
  count.textContent = String(products.length).padStart(2, "0");
  updated.textContent = formatDate(data.updatedAt);
  scanned.textContent = data.scanned ? `${data.scanned} PRODUCTS SCANNED` : "";
  grid.innerHTML = products.map((product) => `
    <article class="card">
      <a class="card-link" href="${product.url}" target="_blank" rel="noreferrer">
        <img class="card-image" src="${product.image || "https://placehold.co/600x800/e8e6e1/777?text=MANGO"}" alt="${product.name}">
        <div class="card-info"><h3 class="card-name">${product.name}</h3><div class="card-number"><span>${product.productNumber || "PRODUCT"}</span><span>↗</span></div></div>
      </a>
    </article>`).join("");
  empty.hidden = products.length !== 0;
}

async function load() {
  const response = await fetch("products.json");
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
