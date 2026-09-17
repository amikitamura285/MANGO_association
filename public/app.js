const accounts = [
  {handle:"ayaka_style", name:"AYAKA / fashion & life", followers:184000, female:78, category:"fashion", engagement:4.8, comments:128, match:98, image:"https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=800&q=85", tags:["fashion","東京","daily look"], bio:"毎日の服と、心地よく暮らすこと。"},
  {handle:"mio__closet", name:"MIO KOBAYASHI", followers:126000, female:81, category:"fashion", engagement:5.2, comments:95, match:96, image:"https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=800&q=85", tags:["fashion","beauty","大阪"], bio:"着回しとお気に入りを紹介しています。"},
  {handle:"nana_life", name:"NANA / lifestyle", followers:243000, female:74, category:"lifestyle", engagement:3.9, comments:64, match:91, image:"https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=800&q=85", tags:["lifestyle","cafe","travel"], bio:"好きなものに囲まれた暮らしの記録。"},
  {handle:"risa_fashion", name:"RISA TANAKA", followers:102000, female:69, category:"fashion", engagement:6.1, comments:142, match:94, image:"https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800&q=85", tags:["fashion","beauty","名古屋"], bio:"シンプルを楽しむ、アラサーコーデ。"},
  {handle:"yui_beauty", name:"YUI / beauty note", followers:318000, female:86, category:"beauty", engagement:4.2, comments:88, match:88, image:"https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=800&q=85", tags:["beauty","skincare","東京"], bio:"肌と向き合う美容習慣。"},
  {handle:"saki_days", name:"SAKI DAYS", followers:76000, female:72, category:"lifestyle", engagement:5.7, comments:71, match:84, image:"https://images.unsplash.com/photo-1524250502761-1ac6f2e30d43?w=800&q=85", tags:["lifestyle","fashion","福岡"], bio:"日々の小さな発見をシェア。"}
];
const targetProfiles = {
  ayaka_style: {handle:"ayaka_style", name:"AYAKA / fashion & life", followers:184000, female:78, category:"fashion", engagement:4.8, tags:["fashion","東京","daily look"], image:"https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=800&q=85"}
};
const $ = (selector) => document.querySelector(selector);
const state = { results: accounts, target: targetProfiles.ayaka_style, saved: new Set(JSON.parse(localStorage.getItem("mango-finder-saved") || "[]")) };

function formatFollowers(value) { return value >= 10000 ? `${(value / 10000).toFixed(value % 10000 ? 1 : 0)}万人` : `${value.toLocaleString()}人`; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[character])); }
function similarity(account, target) {
  const categoryScore = account.category === target.category ? 35 : 0;
  const tagScore = account.tags.filter((tag) => target.tags.includes(tag)).length * 10;
  const followerScore = Math.max(0, 20 - Math.abs(Math.log10(account.followers / target.followers)) * 20);
  const engagementScore = Math.max(0, 15 - Math.abs(account.engagement - target.engagement) * 4);
  return Math.min(99, Math.round(categoryScore + tagScore + followerScore + engagementScore));
}
function meetsFilters(account) {
  const minimum = Number($("#followersFilter").value);
  const female = Number($("#femaleFilter").value);
  const category = $("#categoryFilter").value;
  return account.followers >= minimum && account.female >= female && (category === "all" || account.category === category) &&
    (!$("#commentsFilter").checked || account.comments >= 80) && (!$("#fashionFilter").checked || account.category === "fashion");
}
function getFilteredResults() {
  return accounts.filter((account) => account.handle !== state.target.handle)
    .map((account) => ({ ...account, match: similarity(account, state.target) }))
    .filter(meetsFilters);
}
function render() {
  const sort = $("#sortFilter").value;
  const results = [...state.results].sort((a, b) => sort === "followers" ? b.followers - a.followers : sort === "engagement" ? b.engagement - a.engagement : b.match - a.match);
  $("#resultCount").textContent = `${results.length}件`;
  $("#accountGrid").innerHTML = results.map((account) => `
    <article class="account-card">
      <div class="account-photo"><img src="${account.image}" alt="${account.name}" loading="lazy"><span class="match-badge">${account.match}% MATCH</span><button class="save-button${state.saved.has(account.handle) ? " is-saved" : ""}" data-save="${account.handle}" aria-label="保存">${state.saved.has(account.handle) ? "♥" : "♡"}</button></div>
      <div class="account-content"><div class="account-heading"><div><p class="account-handle">@${account.handle}</p><h3>${account.name}</h3></div><a href="https://www.instagram.com/${account.handle}/" target="_blank" rel="noreferrer" class="external-link" aria-label="Instagramで開く">↗</a></div>
        <p class="account-bio">${account.bio}</p><div class="account-stats"><div><strong>${formatFollowers(account.followers)}</strong><span>フォロワー</span></div><div><strong>${account.female}%</strong><span>女性比率</span></div><div><strong>${account.engagement}%</strong><span>反応率</span></div></div>
        <div class="account-tags">${account.tags.map((tag) => `<span>#${tag}</span>`).join("")}</div><div class="comment-rate"><span>コメント反応</span><div class="bar"><i style="width:${Math.min(account.comments / 1.6, 100)}%"></i></div><b>${account.comments} / post</b></div>
      </div>
    </article>`).join("");
  $("#emptyState").hidden = results.length > 0;
  document.querySelectorAll("[data-save]").forEach((button) => button.addEventListener("click", () => {
    const handle = button.dataset.save;
    if (state.saved.has(handle)) state.saved.delete(handle); else state.saved.add(handle);
    localStorage.setItem("mango-finder-saved", JSON.stringify([...state.saved])); render();
  }));
}
function renderTargetProfile() {
  const target = state.target;
  $("#targetProfile").innerHTML = `<div class="target-avatar"><img src="${target.image}" alt=""></div><div><p class="account-handle">@${escapeHtml(target.handle)}</p><strong>${escapeHtml(target.name)}</strong><span>${formatFollowers(target.followers)} / ${target.category === "fashion" ? "ファッション" : target.category} / 女性フォロワー ${target.female}%</span></div><span class="target-ok">ANALYZED</span>`;
}
function analyzeTarget() {
  const handle = $("#targetHandle").value.trim().replace(/^@/, "").toLowerCase();
  if (!handle) { $("#targetError").hidden = false; return; }
  $("#targetError").hidden = true;
  const known = targetProfiles[handle];
  state.target = known || { handle, name:`@${handle}`, followers:150000, female:65, category:"fashion", engagement:4.5, tags:["fashion","daily look"], image:"https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=800&q=85" };
  state.results = accounts.filter((account) => account.handle !== handle).map((account) => ({ ...account, match: similarity(account, state.target) })).filter(meetsFilters);
  renderTargetProfile(); render(); $("#accountGrid").scrollIntoView({ behavior:"smooth", block:"start" });
}
function updateFemaleLabel() { $("#femaleValue").textContent = `女性 ${$("#femaleFilter").value}%以上`; }
$("#femaleFilter").addEventListener("input", updateFemaleLabel);
["followersFilter", "categoryFilter", "commentsFilter", "fashionFilter", "sortFilter"].forEach((id) => $(`#${id}`).addEventListener("change", () => { state.results = getFilteredResults(); render(); }));
$("#analyzeButton").addEventListener("click", analyzeTarget);
$("#targetHandle").addEventListener("keydown", (event) => { if (event.key === "Enter") analyzeTarget(); });
$("#searchButton").addEventListener("click", () => { state.results = getFilteredResults(); render(); $("#accountGrid").scrollIntoView({ behavior: "smooth", block: "start" }); });
$("#resetButton").addEventListener("click", () => { $("#followersFilter").value = "100000"; $("#femaleFilter").value = "60"; $("#categoryFilter").value = "all"; $("#commentsFilter").checked = true; $("#fashionFilter").checked = false; updateFemaleLabel(); state.results = getFilteredResults(); render(); });
document.querySelectorAll("[data-view]").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("is-active", item === tab));
  document.querySelector("#accountView").hidden = tab.dataset.view !== "accountView";
  document.querySelector("#relationView").hidden = tab.dataset.view !== "relationView";
  if (tab.dataset.view === "relationView" && !window.relationLoaded) loadProducts();
}));
state.results = getFilteredResults();
updateFemaleLabel();
renderTargetProfile();
render();

function buildProductGroups(products) {
  const grouped = new Map();
  products.forEach((product) => {
    const firstDigit = (product.brandItemFirstDigit || product.brandItemNumber || "").match(/\d/)?.[0] || product.productNumber;
    const key = `${product.englishKey}\u0000${firstDigit}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(product);
  });
  return [...grouped.values()].map((items) => ({ main: items[0], related: items.slice(1) }));
}
function loadProducts() {
  window.relationLoaded = true;
  fetch(`products.json?v=${Date.now()}`, { cache: "no-store" }).then((response) => response.json()).then((data) => {
    const groups = buildProductGroups(data.products || []);
    $("#productCount").textContent = String(groups.length).padStart(2, "0");
    $("#updatedAt").textContent = data.updatedAt ? new Intl.DateTimeFormat("ja-JP", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" }).format(new Date(data.updatedAt)) : "—";
    $("#scannedCount").textContent = data.scanned ? `${data.scanned} PRODUCTS SCANNED` : "";
    const image = (product, small) => `<a class="card-link" href="${product.url}" target="_blank" rel="noreferrer"><img class="${small ? "card-image-small" : "card-image"}" src="${product.image}" alt="${product.name}" loading="lazy"><div class="card-info"><h3 class="card-name">${product.name}</h3><div class="card-number"><span>${product.productNumber || "PRODUCT"}</span><span>↗</span></div></div></a>`;
    $("#productGrid").innerHTML = groups.map((group) => `<section class="product-group"><article class="card card-main">${image(group.main, false)}</article>${group.related.length ? `<div class="related-items">${group.related.map((product) => `<article class="card card-related">${image(product, true)}</article>`).join("")}</div>` : ""}</section>`).join("");
    $("#productEmpty").hidden = groups.length > 0;
  }).catch(() => { $("#productEmpty").hidden = false; });
}
