(function () {
  // Cloudflare Worker (cloudflare/relay-worker.js) をデプロイしたら、そのURLをここに設定する
  const RELAY_URL = "";
  const SHOP_ORIGIN = "https://shop.mango.com";
  const SHOP_URL = `${SHOP_ORIGIN}/gb/en/c/women/new-now/56b5c5ed`;

  const panel = document.getElementById("globalUpdatePanel");
  const status = document.getElementById("globalUpdateStatus");
  if (!panel) return;

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  };

  async function buildBookmarklet() {
    const source = await (await fetch(`${dataPathPrefix}tools/collect-global.js?v=${Date.now()}`, { cache: "no-store" })).text();
    const code = source.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n");
    return `javascript:${encodeURIComponent(`${code}\nvoid 0;`)}`;
  }

  async function loadJapanProducts() {
    for (const path of ["japan-index.json", "products.json"]) {
      const response = await fetch(`${dataPathPrefix}${path}?v=${Date.now()}`, { cache: "no-store" });
      if (response.ok) return (await response.json()).products || [];
    }
    throw new Error("日本商品データを読み込めませんでした。");
  }

  async function publish(raw) {
    const response = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `公開サイトへの保存に失敗しました (${response.status})`);
  }

  async function handleRaw(raw) {
    setStatus("日本商品と照合しています…");
    const result = GlobalMatch.buildGlobalResult(raw, await loadJapanProducts());
    if (!result.matches.length) {
      setStatus("関連付けが0件でした。既存データを守るため、反映しませんでした。", true);
      return;
    }
    renderGlobalData(result);
    if (!RELAY_URL) {
      setStatus(`${result.matches.length}件を画面に表示しました。公開サイトへの保存先が未設定のため、この画面だけの表示です。`);
      return;
    }
    setStatus("公開サイトに保存しています…");
    await publish(raw);
    setStatus(`${result.matches.length}件を表示しました。公開サイトへの反映には数分かかります。`);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== SHOP_ORIGIN) return;
    const message = event.data || {};
    if (message.type === "mango-global-progress") setStatus(`収集中: ${message.text}`);
    if (message.type === "mango-global-error") setStatus(`収集に失敗しました: ${message.text}`, true);
    if (message.type === "mango-global-raw") {
      handleRaw(message.raw).catch((error) => setStatus(error.message, true));
    }
  });

  document.getElementById("globalUpdateToggle").addEventListener("click", () => {
    panel.hidden = !panel.hidden;
  });

  const bookmarklet = document.getElementById("globalUpdateBookmarklet");
  buildBookmarklet().then((href) => { bookmarklet.href = href; }).catch(() => setStatus("ブックマークレットを作成できませんでした。", true));
  bookmarklet.addEventListener("click", (event) => {
    event.preventDefault();
    setStatus("このリンクはクリックではなく、ブックマークバーへドラッグしてください。");
  });

  document.getElementById("globalUpdateOpen").addEventListener("click", () => {
    const popup = window.open(SHOP_URL, "mango-finder-shop");
    setStatus(popup
      ? "開いたMANGOのタブで、ブックマーク「MANGO収集」をクリックしてください。"
      : "ポップアップがブロックされました。許可して再度押してください。", !popup);
  });
})();
