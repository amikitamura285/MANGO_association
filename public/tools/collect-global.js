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
  const log = (...args) => console.log("[collect-global]", ...args);
  let apiBlocked = false;

  if (location.origin !== "https://shop.mango.com") {
    throw new Error("https://shop.mango.com/gb/en/ のページを開いてから実行してください。");
  }

  async function fetchText(url) {
    const response = await fetch(url, { credentials: "include" });
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
    const colorId = [...url.matchAll(/\/([^/]+)\/[^/]+$/g)].at(-1)?.[1] || "";
    if (!productNumber || !title) return null;
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
      const response = await fetch(`${API}${productNumber}`);
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
      pages.push({ html: await fetchText(source), newArrivals: source.includes("/new-now/") });
      log("取得元OK:", source);
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
  log(`商品ページ候補 ${urls.length} 件`);
  for (const [index, url] of urls.entries()) {
    try {
      addProduct(parseProduct(url, await fetchText(url)));
    } catch (error) {
      log("スキップ:", url, error.message);
      if (error.message.includes("アクセス制限")) throw error;
    }
    if ((index + 1) % 10 === 0) log(`${index + 1}/${urls.length}`);
  }

  for (const productId of [...new Set(pages.filter((page) => page.newArrivals).flatMap((page) => extractProductIds(page.html)))]) {
    if (products.length >= MAX_PRODUCTS) break;
    if (byBaseCode.has(productId)) continue;
    const apiProduct = await fetchApiProduct(productId);
    if (!apiProduct) continue;
    try {
      addProduct(parseProduct(apiProduct.url, await fetchText(apiProduct.url)) || { ...apiProduct, relatedProductNumbers: [] });
    } catch (error) {
      log("スキップ(新着):", productId, error.message);
      if (error.message.includes("アクセス制限")) throw error;
    }
  }

  const candidates = {};
  for (const product of products) {
    for (const related of product.relatedProductNumbers) {
      const key = `${related.productNumber}:${related.colorId}`;
      if (key in candidates) continue;
      candidates[key] = await fetchApiProduct(related.productNumber, related.colorId);
    }
  }

  const raw = { collectedAt: new Date().toISOString(), products, candidates };
  window.__mangoRaw = raw;
  log(`完了: 商品 ${products.length} 件 / 関連候補 ${Object.values(candidates).filter(Boolean).length} 件`);

  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(raw)], { type: "application/json" }));
  link.download = "global-raw.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
})().catch((error) => console.error("[collect-global] 失敗:", error.message));
