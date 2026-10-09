// shop.mango.com/gb/en/ のページをブラウザで開いた状態で、DevToolsのコンソールに貼り付けて実行する。
// 完了すると global-raw.json がダウンロードされる。
(async () => {
  const SOURCES = [
    "https://shop.mango.com/gb/en/search/women",
    "https://shop.mango.com/gb/en/h/women",
    "https://shop.mango.com/gb/en/c/women/new-now/56b5c5ed"
  ];
  const MAX_PRODUCTS = 100;
  const DELAY_MS = 400;
  const API = "https://online-orchestrator.mango.com/v4/products?channelId=shop&countryIso=GB&languageIso=en&productId=";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const FINDER_ORIGIN = "https://amikitamura285.github.io";
  const banner = document.createElement("div");
  banner.id = "mango-finder-banner";
  banner.style.cssText = "position:fixed;z-index:2147483647;left:0;right:0;top:0;padding:8px 12px;background:#181716;color:#e8ff67;font:14px sans-serif";
  document.body.appendChild(banner);
  const send = (message) => {
    try { window.opener?.postMessage(message, FINDER_ORIGIN); return Boolean(window.opener); } catch { return false; }
  };
  const log = (...args) => {
    console.log("[collect-global]", ...args);
    banner.textContent = `MANGO FINDER: ${args.join(" ")}`;
    send({ type: "mango-global-progress", text: args.join(" ") });
  };
  let apiBlocked = false;

  if (location.origin !== "https://shop.mango.com") {
    throw new Error("https://shop.mango.com/gb/en/ のページを開いてから実行してください。");
  }

  const TIMEOUT_MS = 20000;
  const timed = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  async function pool(items, limit, worker) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await worker(items[index], index);
      }
    }));
  }

  async function fetchText(url) {
    const response = await timed(url, { credentials: "include" });
    const text = await response.text();
    await sleep(DELAY_MS);
    if (response.status === 429 || text.includes("Vercel Security Checkpoint")) {
      throw new Error("アクセス制限(Security Checkpoint)に当たりました。このタブでMANGOのページを普通に開いて表示されることを確認してから、再実行してください。");
    }
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    return text;
  }

  const unescapeJson = (html) => html.replace(/\\u002f/gi, "/").replace(/\\\//g, "/");

  function extractProductUrls(html) {
    const urls = new Set();
    for (const match of unescapeJson(html).matchAll(/(?:https?:\/\/shop\.mango\.com)?\/gb\/en\/p\/[^\s"'<>\\]+/gi)) {
      const absolute = match[0].startsWith("http") ? match[0] : `https://shop.mango.com${match[0]}`;
      urls.add(absolute.replace(/[#?].*$/, "").replace(/\/$/, ""));
    }
    return [...urls];
  }

  function extractProductIds(html) {
    return [...new Set([...html.matchAll(/\\?"productId\\?"\s*:\s*\\?"(\d{8})\\?"/gi)].map((match) => match[1]))];
  }

  function extractRelatedProductNumbers(html, sourceUrl) {
    const sourceNumber = [...sourceUrl.matchAll(/\/(\d{8})\b/g)].at(-1)?.[1] || "";
    const totalLook = html.match(/\\?"totalLook\\?"\s*:\s*\[([\s\S]*?)\]/i)?.[1] || "";
    const related = [];
    for (const match of totalLook.matchAll(/\\?"productId\\?"\s*:\s*\\?"(\d{8})\\?"[\s\S]*?\\?"colorId\\?"\s*:\s*\\?"([^"\\]+)\\?"/gi)) {
      if (match[1] !== sourceNumber) related.push({ productNumber: match[1], colorId: match[2] });
    }
    return related.slice(0, 24);
  }

  function parseProduct(url, html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = doc.querySelector('meta[property="og:title"]')?.content
      || doc.querySelector("h1")?.textContent
      || doc.title;
    const image = doc.querySelector('meta[property="og:image"]')?.content || "";
    const productNumber = [...url.matchAll(/\/(\d{8})\b/g)].at(-1)?.[1] || "";
    const colorId = url.match(/\/\d{8}\/([A-Za-z0-9]{1,4})(?:\/|$)/)?.[1] || "";
    if (!productNumber || !colorId || !title) return null;
    return {
      name: title.replace(/\s+/g, " ").replace(/\s*\|\s*MANGO.*$/i, "").trim(),
      image,
      productNumber,
      baseCode: productNumber,
      globalCode: productNumber,
      colorId,
      url,
      relatedProductNumbers: extractRelatedProductNumbers(html, url)
    };
  }

  async function fetchApiProduct(productNumber, requestedColorId = "") {
    if (apiBlocked) return null;
    let data;
    try {
      const response = await timed(`${API}${productNumber}`);
      await sleep(DELAY_MS);
      if (!response.ok) return null;
      data = await response.json();
    } catch (error) {
      apiBlocked = true;
      log("商品APIにアクセスできませんでした(CORS等)。関連商品の解決をスキップします:", error.message);
      return null;
    }
    const color = data.colors?.find((entry) => String(entry.id) === String(requestedColorId)) || data.colors?.[0];
    const colorId = color?.id || "99";
    const imagePath = Object.values(color?.looks?.["00"]?.images || {}).find((entry) => entry?.img)?.img;
    const productPath = String(data.url || "").replace(/\/$/, "");
    if (!data.reference || !productPath) return null;
    return {
      name: data.nameEn || data.name || `MANGO ${productNumber}`,
      image: imagePath ? `${data.assetsDomain || "https://media.mango.com"}${imagePath}?wid=1024` : "",
      productNumber: String(data.reference),
      baseCode: String(data.reference),
      globalCode: String(data.reference),
      colorId: String(colorId),
      colorName: color?.nameEn || color?.name || "",
      url: `https://shop.mango.com${productPath}/${colorId}/00`
    };
  }

  const pages = [{ html: document.documentElement.outerHTML, newArrivals: location.pathname.includes("/new-now/") }];
  for (const source of SOURCES) {
    try {
      const html = await fetchText(source);
      pages.push({ html, newArrivals: source.includes("/new-now/") });
      log(`取得元OK(商品URL ${extractProductUrls(html).length}件):`, source);
    } catch (error) {
      log("取得元NG:", source, error.message);
      if (error.message.includes("アクセス制限")) throw error;
    }
  }

  const products = [];
  const byBaseCode = new Set();
  const addProduct = (product) => {
    if (!product || !product.baseCode || byBaseCode.has(product.baseCode)) return;
    byBaseCode.add(product.baseCode);
    products.push(product);
  };

  const urls = [...new Set(pages.flatMap((page) => extractProductUrls(page.html)))].slice(0, MAX_PRODUCTS);
  log(`[1/3] 商品ページ ${urls.length} 件を読み込みます`);
  let skipped = 0;
  let blocked = null;
  let done = 0;
  await pool(urls, 3, async (url) => {
    if (blocked) return;
    try {
      const product = parseProduct(url, await fetchText(url));
      if (!product) skipped += 1;
      addProduct(product);
    } catch (error) {
      skipped += 1;
      if (error.message.includes("アクセス制限")) blocked = error;
    }
    done += 1;
    if (done % 5 === 0 || done === urls.length) log(`[1/3] 商品ページ ${done}/${urls.length} (商品 ${products.length}件)`);
  });
  if (blocked) throw blocked;

  const newIds = [...new Set(pages.filter((page) => page.newArrivals).flatMap((page) => extractProductIds(page.html)))]
    .filter((productId) => !byBaseCode.has(productId))
    .slice(0, Math.max(0, MAX_PRODUCTS - products.length));
  log(`[2/3] 新着商品 ${newIds.length} 件を追加で読み込みます`);
  done = 0;
  await pool(newIds, 3, async (productId) => {
    if (blocked || products.length >= MAX_PRODUCTS) return;
    const apiProduct = await fetchApiProduct(productId);
    if (apiProduct) {
      try {
        addProduct(parseProduct(apiProduct.url, await fetchText(apiProduct.url)) || { ...apiProduct, relatedProductNumbers: [] });
      } catch (error) {
        skipped += 1;
        if (error.message.includes("アクセス制限")) blocked = error;
      }
    }
    done += 1;
    if (done % 5 === 0 || done === newIds.length) log(`[2/3] 新着 ${done}/${newIds.length} (商品 ${products.length}件)`);
  });
  if (blocked) throw blocked;

  const relatedEntries = new Map();
  for (const product of products) {
    for (const related of product.relatedProductNumbers) relatedEntries.set(`${related.productNumber}:${related.colorId}`, related);
  }
  const relatedList = [...relatedEntries.entries()].slice(0, 600);
  log(`[3/3] 関連候補 ${relatedList.length} 件を調べます`);
  const candidates = {};
  done = 0;
  await pool(relatedList, 4, async ([key, related]) => {
    candidates[key] = await fetchApiProduct(related.productNumber, related.colorId);
    done += 1;
    if (done % 10 === 0 || done === relatedList.length) log(`[3/3] 関連候補 ${done}/${relatedList.length}`);
  });

  const raw = { collectedAt: new Date().toISOString(), products, candidates };
  window.__mangoRaw = raw;
  const summary = `商品 ${products.length} 件(取得できず ${skipped} 件) / 関連候補 ${Object.values(candidates).filter(Boolean).length} 件`;
  log(`収集終了: ${summary}`);
  document.title = `【収集完了】${document.title}`;
  banner.style.background = "#1f7a3a";
  banner.style.color = "#fff";
  try { window.opener?.focus(); } catch {}

  if (send({ type: "mango-global-raw", raw })) {
    banner.textContent = `MANGO FINDER: 収集完了 (${summary})。元のページにデータを送信しました。このタブは閉じて構いません。`;
    return;
  }
  banner.textContent = `MANGO FINDER: 収集完了 (${summary})。元のページに送信できなかったため global-raw.json をダウンロードしました。`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(raw)], { type: "application/json" }));
  link.download = "global-raw.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
})().catch((error) => {
  console.error("[collect-global] 失敗:", error.message);
  const failed = document.getElementById("mango-finder-banner");
  if (failed) {
    failed.textContent = `MANGO FINDER: 失敗 - ${error.message}`;
    failed.style.background = "#b3261e";
    failed.style.color = "#fff";
  }
  document.title = `【収集失敗】${document.title}`;
  try { window.opener?.postMessage({ type: "mango-global-error", text: error.message }, "https://amikitamura285.github.io"); } catch {}
});
