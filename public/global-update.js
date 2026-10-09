(function () {
  // Apps Script (apps-script/Code.gs) をウェブアプリとしてデプロイしたら、そのURL(…/exec)をここに設定する
  const RELAY_URL = "https://script.google.com/macros/s/AKfycby6IA2sF1896ef4iyxa_sxcgZ6ikz-DZtdUtlFAzuAnzJwL8puhqeGbciEonpBM0KFt/exec";
  const SHOP_ORIGIN = "https://shop.mango.com";
  const SHOP_URL = `${SHOP_ORIGIN}/gb/en/c/women/new-now/56b5c5ed`;

  const panel = document.getElementById("globalUpdatePanel");
  const status = document.getElementById("globalUpdateStatus");
  if (!panel) return;

  const logLines = [];
  let headline = "";
  const render = () => { status.textContent = [headline, ...logLines.slice(-14)].filter(Boolean).join("\n"); };
  const setStatus = (text, isError = false) => {
    headline = text;
    status.classList.toggle("is-error", isError);
    render();
  };
  const addLog = (text) => { logLines.push(text); render(); };

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
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ raw })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || `公開サイトへの保存に失敗しました (${response.status})`);
  }

  const clock = () => new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  async function handleRaw(raw) {
    const candidateCount = Object.values(raw.candidates || {}).filter(Boolean).length;
    const counts = `収集 商品${(raw.products || []).length}件 / 関連候補${candidateCount}件`;
    setStatus(`${clock()} 収集完了(${counts})。日本商品と照合しています…`);
    const base = GlobalMatch.buildGlobalResult(raw, await loadJapanProducts());
    if (!base.matches.length) {
      setStatus(`${clock()} ${counts} / 一致0件。一致が0件だったため、既存データを守るため反映しませんでした。`, true);
      return;
    }
    const existing = await fetch(`${dataPathPrefix}global-products.json?v=${Date.now()}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null)).catch(() => null);
    const result = GlobalMatch.applyDisplayHistory(base, raw.collectedAt, existing);
    const found = `${counts} / 一致${base.matches.length}件(うち新規${result.matches.length}件)`;
    renderGlobalData(result);
    if (!RELAY_URL) {
      setStatus(`${clock()} ${found}。公開サイトへの保存先が未設定のため、この画面だけの表示です。`);
      return;
    }
    setStatus(`${clock()} ${found}。公開サイトに保存しています…`);
    try {
      await publish(raw);
    } catch (error) {
      setStatus(`${clock()} ${found}。画面には表示しましたが、公開サイトへの保存に失敗しました: ${error.message}`, true);
      return;
    }
    setStatus(`【完了】${clock()} すべて完了しました。${found}。公開サイトへの反映には数分かかります(LAST UPDATEDはそのとき更新されます)。`);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== SHOP_ORIGIN) return;
    const message = event.data || {};
    if (message.type === "mango-global-progress") { if (!logLines.length) setStatus("収集中です。完了と表示されるまでお待ちください…"); addLog(message.text); }
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
