const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "products.json");
const GLOBAL_DATA_FILE = path.join(ROOT, "data", "global-products.json");
const PORT = Number(process.env.PORT || 3000);
const SITEMAP = "https://japan.mango.com/sitemap_commodity.xml";
const BASE = "https://japan.mango.com";
const GLOBAL_PRODUCT_SOURCES = [
  "https://shop.mango.com/gb/en/search/women",
  "https://shop.mango.com/gb/en/h/women",
  "https://shop.mango.com/gb/en/c/women/new-now/56b5c5ed"
];
const CRAWL_LIMIT = Number(process.env.CRAWL_LIMIT || 0);
const CRAWL_CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY || 12);
const headers = { "user-agent": process.env.CRAWLER_USER_AGENT || "MangoMonitor/1.0 (+local product monitor)" };
let crawlState = { status: "idle", startedAt: null, finishedAt: null, count: 0, error: null };

async function readProducts() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { updatedAt: null, products: [] };
    throw error;
  }
}

async function readGlobalProducts() {
  try {
    return JSON.parse(await fs.readFile(GLOBAL_DATA_FILE, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { updatedAt: null, products: [] };
    throw error;
  }
}

async function writeProducts(value) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(value, null, 2), "utf8");
}

async function writeGlobalProducts(value) {
  await fs.mkdir(path.dirname(GLOBAL_DATA_FILE), { recursive: true });
  await fs.writeFile(GLOBAL_DATA_FILE, JSON.stringify(value, null, 2), "utf8");
}

function decodeHtml(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function stripTags(value) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function englishKey(name) {
  return (name.match(/[A-Za-z][A-Za-z0-9'&+\-/ ]*/g) || []).join(" ")
    .replace(/[^A-Za-z0-9]+/g, " ").trim().toUpperCase();
}

function firstDigit(value) {
  return value.match(/\d/)?.[0] || "";
}

function displayGroupKey(product) {
  return `${product.englishKey}\u0000${product.brandItemFirstDigit || product.productNumber}`;
}

function firstMatch(html, expressions) {
  for (const expression of expressions) {
    const match = html.match(expression);
    if (match && match[1]) return stripTags(match[1]);
  }
  return "";
}

function parseJsonLd(html) {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const value = JSON.parse(script[1].trim());
      const candidates = Array.isArray(value) ? value : [value, ...(value["@graph"] || [])];
      const product = candidates.find((item) => item && (item["@type"] === "Product" || item.name));
      if (product) return product;
    } catch {
      // A malformed JSON-LD block should not prevent other extraction strategies.
    }
  }
  return {};
}

function parseProduct(url, html) {
  const json = parseJsonLd(html);
  const brandCode = firstMatch(html, [
    /<input[^>]+id=["']brandCode["'][^>]+value=["']([^"']+)/i
  ]);
  const brandName = firstMatch(html, [
    /<input[^>]+id=["']searchBrandName["'][^>]+value=["']([^"']+)/i,
    /<p[^>]+class=["']brandName["'][^>]*>([^<{]+)<\/p>/i
  ]).toUpperCase();
  const name = stripTags(String(json.name || firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ])));
  const image = typeof json.image === "string" ? json.image : Array.isArray(json.image) ? json.image[0] : firstMatch(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i
  ]);
  const urlProductNumber = url.match(/\/commodity\/[^/]+\/([^/]+)\/?$/i)?.[1] || "";
  const productNumber = urlProductNumber || firstMatch(html, [
    /(?:商品番号|Product\s*(?:code|number)|Ref(?:erence)?)[^<:：]{0,30}[:：]?\s*([A-Z0-9-]{5,})/i
  ]) || url.match(/\/([^/]+)\/?$/)?.[1] || "";
  const brandItemRow = html.match(/<tr[^>]*class=["'][^"']*-brandItemCode[^"']*["'][^>]*>([\s\S]*?)<\/tr>/i)?.[1] || "";
  const brandItemNumber = stripTags(brandItemRow.replace(/<th[\s\S]*?<\/th>/i, "")).trim();
  const relatedSections = [...html.matchAll(/<section[^>]*(?:id=["']related_product["']|related|recommend|おすすめ|関連)[^>]*>([\s\S]*?)<\/section>/gi)]
    .map((match) => match[1]);
  const relatedNames = relatedSections.flatMap((section) => [
    ...section.matchAll(/<img[^>]+alt=["']([^"']+)["']/gi)
  ].map((match) => stripTags(match[1])));
  return {
    name,
    image,
    productNumber,
    brandItemNumber,
    brandItemFirstDigit: firstDigit(brandItemNumber),
    url,
    brandCode,
    brandName,
    englishKey: englishKey(name),
    relatedNames,
    variationProductNumbers: []
  };
}

async function fetchText(url) {
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} (${url})`);
  return response.text();
}

async function fetchVariationProductNumbers(productNumber) {
  try {
    const response = JSON.parse(await fetchText(`${BASE}/commodity/${productNumber}/colors`));
    return (response.relatedCommodityStocks || [])
      .map((item) => item.commodityCode)
      .filter((code) => code && code !== productNumber);
  } catch (error) {
    console.warn(`Variation lookup failed for ${productNumber}: ${error.message}`);
    return [];
  }
}

async function mapConcurrent(values, worker, concurrency) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex++;
      if (index >= values.length) return;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, consume));
  return results;
}

function extractGlobalProductUrls(html, sourceUrl = "") {
  const urls = new Set();
  const seen = new Set();
  const record = (value) => {
    if (!value || !/\/gb\/en\//.test(value)) return;
    const absolute = value.startsWith("http") ? value : `https://shop.mango.com${value.startsWith("/") ? value : `/${value}`}`;
    const normalized = absolute.replace(/[#?].*$/, "").replace(/\/$/, "");
    if (!/\/gb\/en\/p\//.test(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    urls.add(normalized);
  };

  for (const pattern of [
    /https?:\/\/shop\.mango\.com\/gb\/en\/p\/[^\s"'<>]+/gi,
    /\/gb\/en\/p\/[^\s"'<>]+/gi,
    /(?:href|data-href|content|src|data-url)=["']([^"']+)["']/gi
  ]) {
    for (const match of html.matchAll(pattern)) {
      const value = match[1] || match[0];
      record(value.replace(/^"|^'|"$|'$/g, ""));
    }
  }

  if (sourceUrl && /\/gb\/en\/p\//.test(sourceUrl)) {
    const sourceProductNumber = [...sourceUrl.matchAll(/\/(\d{8})\b/g)].at(-1)?.[1];
    const sourceCode = sourceProductNumber || "";
    if (sourceCode) {
      const sourceCandidate = sourceUrl.replace(/\/(\d{8})\b/, `/${sourceCode}`);
      record(sourceCandidate);
    }
  }

  return [...urls];
}

function parseGlobalProduct(url, html) {
  const title = firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ]);
  const image = firstMatch(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i,
    /<img[^>]+src=["']([^"']+)["'][^>]*>/i
  ]);
  const productNumber = [...url.matchAll(/\/(\d{8})\b/g)].at(-1)?.[1] || "";
  const baseCode = productNumber.match(/\d{8}/)?.[0] || "";
  if (!productNumber || !baseCode || !title) return null;
  return {
    name: stripTags(title).replace(/\s*\|\s*MANGO.*$/i, "").trim(),
    image,
    productNumber: productNumber,
    baseCode,
    globalCode: baseCode,
    url
  };
}

function normalizeComparisonName(value) {
  if (!value) return "";
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeBrandBaseCode(value) {
  if (!value) return "";
  const match = String(value).match(/(\d{8})/);
  return match ? match[1] : "";
}

async function crawlGlobalProducts(japanProducts = []) {
  const products = [];
  const visited = new Set();
  for (const source of GLOBAL_PRODUCT_SOURCES) {
    try {
      const html = await fetchText(source);
      const candidateUrls = extractGlobalProductUrls(html, source);
      for (const productUrl of candidateUrls) {
        if (visited.has(productUrl)) continue;
        visited.add(productUrl);
        try {
          const detailHtml = await fetchText(productUrl);
          const product = parseGlobalProduct(productUrl, detailHtml);
          if (product && product.baseCode) products.push(product);
        } catch (error) {
          console.warn(`Skipping global product ${productUrl}: ${error.message}`);
        }
      }
    } catch (error) {
      console.warn(`Global catalog source failed: ${source} :: ${error.message}`);
    }
  }
  const deduped = products.filter((product, index, array) => array.findIndex((entry) => entry.baseCode === product.baseCode) === index);
  const globalIndex = new Map();
  deduped.forEach((product) => {
    if (!globalIndex.has(product.baseCode)) globalIndex.set(product.baseCode, []);
    globalIndex.get(product.baseCode).push(product);
  });

  const matches = deduped.map((globalProduct) => {
    const baseCode = globalProduct.baseCode || normalizeBrandBaseCode(globalProduct.productNumber || globalProduct.url || "");
    const related = (japanProducts || []).filter((item) => {
      const itemBaseCode = normalizeBrandBaseCode(item.brandItemNumber || item.brandItemFirstDigit || item.productNumber || "");
      if (itemBaseCode !== baseCode) return false;
      const sameName = normalizeComparisonName(item.name || "") === normalizeComparisonName(globalProduct.name || "");
      const sameEnglishKey = englishKey(item.name || "") && englishKey(globalProduct.name || "") && englishKey(item.name || "") === englishKey(globalProduct.name || "");
      return !sameName && !sameEnglishKey;
    });
    return { main: globalProduct, related, baseCode };
  }).filter((entry) => entry.baseCode && entry.related.length > 0);

  const result = {
    updatedAt: new Date().toISOString(),
    products: deduped.slice(0, 200),
    matches
  };
  await writeGlobalProducts(result);
  await fs.writeFile(path.join(ROOT, "public", "global-products.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function crawl() {
  if (crawlState.status === "running") return;
  crawlState = { status: "running", startedAt: new Date().toISOString(), finishedAt: null, count: 0, error: null };
  try {
    const sitemap = await fetchText(SITEMAP);
    const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    const urls = CRAWL_LIMIT > 0 ? sitemapUrls.slice(0, CRAWL_LIMIT) : sitemapUrls;
    const previous = await readProducts();
    const previouslySeen = new Set(previous.displayedMainProductNumbers || []);
    const products = (await mapConcurrent(urls, async (url) => {
      try {
        const product = parseProduct(url, await fetchText(url));
        product.variationProductNumbers = await fetchVariationProductNumbers(product.productNumber);
        const isMangoBrand = product.brandCode === "MA1658" && product.brandName === "MANGO";
        return product.name && product.englishKey && isMangoBrand ? product : null;
      } catch (error) {
        console.warn(`Skipping ${url}: ${error.message}`);
        return null;
      }
    }, CRAWL_CONCURRENCY)).filter(Boolean);
    const variationProductNumbers = new Set(products.flatMap((product) => product.variationProductNumbers));
    const eligibleProducts = products.filter((product) => !variationProductNumbers.has(product.productNumber));
    const eligibleGroups = new Map();
    for (const product of eligibleProducts) {
      const key = displayGroupKey(product);
      if (!eligibleGroups.has(key)) eligibleGroups.set(key, []);
      eligibleGroups.get(key).push(product);
    }
    const matchedCandidates = eligibleProducts.filter((product) => {
      const sameNameProducts = eligibleGroups.get(displayGroupKey(product)) || [];
      const hasSameRelated = product.relatedNames.some((related) => englishKey(related) === product.englishKey);
      return sameNameProducts.length > 1 && !hasSameRelated;
    });
    const matchedGroups = new Map();
    for (const product of matchedCandidates) {
      const key = displayGroupKey(product);
      if (!matchedGroups.has(key)) matchedGroups.set(key, []);
      matchedGroups.get(key).push(product);
    }
    const matched = [...matchedGroups.entries()]
      .filter(([, items]) => items.length > 1)
      .flatMap(([, items]) => items)
      .map(({ relatedNames, variationProductNumbers, ...product }) => product);
    const displayBuckets = new Map();
    for (const product of matched) {
      const bucketKey = displayGroupKey(product);
      if (!displayBuckets.has(bucketKey)) displayBuckets.set(bucketKey, []);
      displayBuckets.get(bucketKey).push(product);
    }
    const displayGroups = [...displayBuckets.entries()]
      .map(([, items]) => {
        const newItems = items.filter((item) => !previouslySeen.has(item.productNumber));
        if (!newItems.length) return null;
        const main = newItems[0];
        return { englishKey: main.englishKey, main, related: items.filter((item) => item !== main) };
      }).filter(Boolean);
    const displayedMainProductNumbers = [...new Set([
      ...previouslySeen,
      ...displayGroups.map((group) => group.main.productNumber)
    ])];
    const result = {
      updatedAt: new Date().toISOString(),
      products: matched,
      groups: displayGroups,
      newCount: displayGroups.length,
      displayedMainProductNumbers,
      scanned: products.length
    };
    await writeProducts(result);
    await fs.writeFile(path.join(ROOT, "public", "products.json"), JSON.stringify(result, null, 2), "utf8");
    await crawlGlobalProducts(matched);
    crawlState = { ...crawlState, status: "idle", finishedAt: new Date().toISOString(), count: matched.length };
  } catch (error) {
    crawlState = { ...crawlState, status: "error", finishedAt: new Date().toISOString(), error: error.message };
  }
}

function nextFourAmJst() {
  const now = new Date();
  const japanNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const targetJapanUtc = Date.UTC(
    japanNow.getUTCFullYear(),
    japanNow.getUTCMonth(),
    japanNow.getUTCDate(),
    4, 0, 0, 0
  ) - 9 * 60 * 60 * 1000;
  const target = new Date(targetJapanUtc <= now.getTime() ? targetJapanUtc + 24 * 60 * 60 * 1000 : targetJapanUtc);
  return target.getTime() - now.getTime();
}

function schedule() {
  setTimeout(() => { crawl(); schedule(); }, nextFourAmJst());
}

async function serve(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  if (requestUrl.pathname === "/api/products") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    return response.end(JSON.stringify(await readProducts()));
  }
  if (requestUrl.pathname === "/api/status") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    return response.end(JSON.stringify(crawlState));
  }
  if (requestUrl.pathname === "/api/crawl" && request.method === "POST") {
    crawl();
    response.writeHead(202, { "content-type": "application/json; charset=utf-8" });
    return response.end(JSON.stringify({ accepted: true }));
  }
  const relative = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.replace(/^\/+/, "");
  const file = path.join(ROOT, "public", relative);
  if (!file.startsWith(path.join(ROOT, "public"))) {
    response.writeHead(403); return response.end("Forbidden");
  }
  try {
    const content = await fs.readFile(file);
    const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html";
    response.writeHead(200, { "content-type": `${type}; charset=utf-8` });
    response.end(content);
  } catch {
    response.writeHead(404); response.end("Not found");
  }
}

const server = http.createServer((request, response) => serve(request, response).catch((error) => {
  response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: error.message }));
}));

if (process.argv.includes("--crawl")) {
  crawl().then(() => process.exit(crawlState.status === "error" ? 1 : 0));
} else {
  server.listen(PORT, () => console.log(`Mango Monitor: http://localhost:${PORT}`));
  schedule();
}
