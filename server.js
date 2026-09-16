const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "products.json");
const PORT = Number(process.env.PORT || 3000);
const SITEMAP = "https://japan.mango.com/sitemap_commodity.xml";
const BASE = "https://japan.mango.com";
const CRAWL_LIMIT = Number(process.env.CRAWL_LIMIT || 200);
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

async function writeProducts(value) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(value, null, 2), "utf8");
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
  const relatedHtml = [...html.matchAll(/<(?:section|div|ul)[^>]*(?:related|recommend|おすすめ|関連)[^>]*>([\s\S]*?)<\/(?:section|div|ul)>/gi)]
    .map((match) => stripTags(match[1])).join(" ");
  const relatedNames = relatedHtml ? relatedHtml.split(/\s{2,}|(?=おすすめ|関連)/).map((value) => value.trim()).filter(Boolean) : [];
  return { name, image, productNumber, url, englishKey: englishKey(name), relatedNames, variationProductNumbers: [] };
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

async function crawl() {
  if (crawlState.status === "running") return;
  crawlState = { status: "running", startedAt: new Date().toISOString(), finishedAt: null, count: 0, error: null };
  try {
    const sitemap = await fetchText(SITEMAP);
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]).slice(0, CRAWL_LIMIT);
    const previous = await readProducts();
    const previouslySeen = new Set(previous.displayedMainProductNumbers || []);
    const products = [];
    for (const url of urls) {
      try {
        const product = parseProduct(url, await fetchText(url));
        product.variationProductNumbers = await fetchVariationProductNumbers(product.productNumber);
        if (product.name && product.englishKey) products.push(product);
      } catch (error) {
        console.warn(`Skipping ${url}: ${error.message}`);
      }
    }
    const allGroups = new Map();
    for (const product of products) {
      if (!allGroups.has(product.englishKey)) allGroups.set(product.englishKey, []);
      allGroups.get(product.englishKey).push(product);
    }
    const variationProductNumbers = new Set(products.flatMap((product) => product.variationProductNumbers));
    const matched = products.filter((product) => {
      const sameNameProducts = allGroups.get(product.englishKey) || [];
      const hasSameRelated = product.relatedNames.some((related) => englishKey(related) === product.englishKey);
      const isVariation = variationProductNumbers.has(product.productNumber);
      return sameNameProducts.length > 1 && !hasSameRelated && !isVariation;
    }).map(({ relatedNames, variationProductNumbers, ...product }) => product);
    const matchedGroups = new Map();
    for (const product of matched) {
      if (!matchedGroups.has(product.englishKey)) matchedGroups.set(product.englishKey, []);
      matchedGroups.get(product.englishKey).push(product);
    }
    const displayGroups = [...matchedGroups.entries()].map(([englishKey, items]) => {
      const newItems = items.filter((item) => !previouslySeen.has(item.productNumber));
      if (!newItems.length) return null;
      const main = newItems[0];
      return { englishKey, main, related: items.filter((item) => item !== main) };
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
