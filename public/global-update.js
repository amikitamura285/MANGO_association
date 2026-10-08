(function () {
  const TOKEN_KEY = "mango-monitor-gh-token";
  const SHOP_ORIGIN = "https://shop.mango.com";
  const SHOP_URL = `${SHOP_ORIGIN}/gb/en/c/women/new-now/56b5c5ed`;
  const OWNER = location.hostname.endsWith(".github.io") ? location.hostname.split(".")[0] : "amikitamura285";
  const REPO = location.hostname.endsWith(".github.io") ? location.pathname.split("/")[1] : "MANGO_association";
  const COMMIT_PATHS = ["public/global-products.json", "data/global-products.json"];

  const panel = document.getElementById("globalUpdatePanel");
  const status = document.getElementById("globalUpdateStatus");
  const tokenInput = document.getElementById("globalUpdateToken");
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

  const toBase64 = (text) => btoa(unescape(encodeURIComponent(text)));

  async function putFile(token, path, text) {
    const api = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`;
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await fetch(`${api}?ref=main`, { headers, cache: "no-store" });
      const sha = current.ok ? (await current.json()).sha : undefined;
      const response = await fetch(api, {
        method: "PUT",
        headers,
        body: JSON.stringify({ message: "chore: update global data from browser", content: toBase64(text), sha, branch: "main" })
      });
      if (response.ok) return;
      if (response.status !== 409 || attempt === 1) {
        throw new Error(`GitHubへの保存に失敗しました (${path}: ${response.status})`);
      }
    }
  }

  async function handleRaw(raw) {
    setStatus("日本商品と照合しています…");
    const result = GlobalMatch.buildGlobalResult(raw, await loadJapanProducts());
    if (!result.matches.length) {
      setStatus("関連付けが0件でした。既存データを守るため、反映しませんでした。", true);
      return;
    }
    renderGlobalData(result);
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setStatus(`${result.matches.length}件を画面に表示しました。トークン未設定のため公開サイトには反映されていません。`);
      return;
    }
    setStatus("公開サイトに保存しています…");
    const text = JSON.stringify(result, null, 2);
    for (const path of COMMIT_PATHS) await putFile(token, path, text);
    setStatus(`${result.matches.length}件を保存しました。公開サイトへの反映には1〜2分かかります。`);
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

  tokenInput.value = localStorage.getItem(TOKEN_KEY) ? "********" : "";
  document.getElementById("globalUpdateSaveToken").addEventListener("click", () => {
    const value = tokenInput.value.trim();
    if (value === "********") return;
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
    tokenInput.value = value ? "********" : "";
    setStatus(value ? "トークンを保存しました。" : "トークンを削除しました。");
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
