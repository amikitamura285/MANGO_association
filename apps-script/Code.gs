// Google Apps Script (ウェブアプリ): ブラウザで収集したMANGOグローバル商品データを検証し、data/global-raw.json としてコミットする。
// スクリプトプロパティ: GITHUB_TOKEN (Fine-grained token / このリポジトリの Contents: Read and write、UPDATEボタン用に Actions: Read and write)
var OWNER = "amikitamura285";
var REPO = "MANGO_association";
var BRANCH = "main";
var FILE_PATH = "data/global-raw.json";
var MAX_BODY_CHARS = 3000000;
var MIN_INTERVAL_MS = 10 * 60 * 1000;
var MIN_PRODUCTS = 10;
var MAX_PRODUCTS = 300;
var MAX_CANDIDATES = 4000;
var CHECKED_KEY = "CHECKED_CODES";
var MAX_CHECKED = 600;
var RELATION_CHECKED_KEY = "CHECKED_RELATION";
var MAX_RELATION_CHECKED = 450;
var CRAWL_WORKFLOW = "crawl.yml";
var CRAWL_KEY = "LAST_CRAWL_AT";
var CRAWL_INTERVAL_MS = 15 * 60 * 1000;

function doGet(e) {
  if (e && e.parameter && e.parameter.action === "checked") {
    var scope = scope_(e.parameter.scope);
    return json_({ ok: true, checked: readChecked_(scope) });
  }
  return json_({ ok: true, message: "MANGO FINDER relay" });
}

function scope_(value) {
  return value === "relation" ? "relation" : "global";
}

function checkedKey_(scope) {
  return scope === "relation" ? RELATION_CHECKED_KEY : CHECKED_KEY;
}

function checkedCode_(scope, value) {
  if (scope === "relation") return typeof value === "string" && /^[A-Za-z0-9]{6,20}$/.test(value) ? value : null;
  return code8_(value);
}

function maxChecked_(scope) {
  return scope === "relation" ? MAX_RELATION_CHECKED : MAX_CHECKED;
}

function readChecked_(scope) {
  try {
    var list = JSON.parse(PropertiesService.getScriptProperties().getProperty(checkedKey_(scope)) || "[]");
    return Array.isArray(list) ? list.filter(function (code) { return checkedCode_(scope, code); }) : [];
  } catch (error) {
    return [];
  }
}

function setChecked_(parsed) {
  var scope = scope_(parsed.scope);
  var codes = Array.isArray(parsed.productNumbers) ? parsed.productNumbers : [parsed.productNumber];
  codes = codes.slice(0, 1000).map(function (value) { return checkedCode_(scope, value); });
  if (!codes.length || codes.some(function (code) { return !code; }) || typeof parsed.checked !== "boolean") fail_("確認済の指定が正しくありません。");
  var list = readChecked_(scope).filter(function (entry) { return codes.indexOf(entry) < 0; });
  if (parsed.checked) list = list.concat(codes);
  list = list.slice(-maxChecked_(scope));
  PropertiesService.getScriptProperties().setProperty(checkedKey_(scope), JSON.stringify(list));
  return { ok: true, checked: list };
}

var EARRING_DAILY_LIMIT = 40;
var EARRING_DAY_KEY = "EARRING_DAY";
var DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-image";

function isEarringRequest_(e) {
  var body = e && e.postData ? e.postData.contents : "";
  return body.slice(0, 80).indexOf('"action":"earring') >= 0;
}

// 利用回数を1日の上限で数える(日本時間で日替わり)。上限を超えていたら null
function reserveEarringQuota_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) fail_("混み合っています。少し待ってからもう一度お試しください。");
  try {
    var props = PropertiesService.getScriptProperties();
    var today = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd");
    var state;
    try { state = JSON.parse(props.getProperty(EARRING_DAY_KEY) || "{}"); } catch (error) { state = {}; }
    if (state.date !== today) state = { date: today, count: 0 };
    if (state.count >= EARRING_DAILY_LIMIT) return null;
    state.count += 1;
    props.setProperty(EARRING_DAY_KEY, JSON.stringify(state));
    return EARRING_DAILY_LIMIT - state.count;
  } finally {
    lock.releaseLock();
  }
}

function refundEarringQuota_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var state = JSON.parse(props.getProperty(EARRING_DAY_KEY) || "{}");
    if (state.count > 0) {
      state.count -= 1;
      props.setProperty(EARRING_DAY_KEY, JSON.stringify(state));
    }
  } catch (error) {
  } finally {
    lock.releaseLock();
  }
}

function earringPrompt_(heightMm, widthMm) {
  return [
    "Create a photorealistic, high-quality close-up photo of the side of a woman's head, with her hair tucked back so one ear and earlobe are fully visible, wearing the earring shown in the attached product photos (the photos show the same earring).",
    "Reproduce the earring's exact design, shape, color, material and finish from the photos. Do not add or change any details.",
    "The real earring measures " + heightMm + " mm tall and " + widthMm + " mm wide. Render it at exactly that scale relative to the ear: an adult earlobe is about 20 mm tall and the whole ear about 60 mm tall.",
    "Soft natural studio lighting, plain neutral background, no text, no watermark, no other jewelry. Show only one ear."
  ].join(" ");
}

// 日本のMANGOの商品ページだけを受け付ける(任意のURLを取りに行かせない)
function parseJapanProductUrl_(value) {
  var match = typeof value === "string" && value.length <= 300
    ? value.trim().match(/^https:\/\/japan\.mango\.com\/commodity\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/)
    : null;
  if (!match) fail_("日本のMANGOの商品ページのURL(https://japan.mango.com/commodity/…)を入力してください。");
  return { shop: match[1], code: match[2], url: "https://japan.mango.com/commodity/" + match[1] + "/" + match[2] + "/" };
}

function decodeHtml_(text) {
  return String(text || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function earringImageUrls_(html, code) {
  var found = {};
  var pattern = new RegExp("https://[a-z0-9.-]*locondo\\.jp/[^\"'\\s<>]*" + code + "_(\\d+)_l\\.jpg", "gi");
  var match;
  while ((match = pattern.exec(html)) !== null) found[Number(match[1])] = match[0];
  var numbers = Object.keys(found).map(Number).sort(function (x, y) { return x - y; });
  if (!numbers.length) {
    var og = html.match(/property="og:image"\s+content="([^"]+)"/i);
    if (og && /^https:\/\/[a-z0-9.-]*locondo\.jp\//i.test(og[1])) return [og[1]];
    return [];
  }
  return numbers.slice(0, 2).map(function (n) { return found[n]; });
}

// "0.7×3.7"(cm)のような表記から [縦mm, 横mm] を作る。大きい方を縦(全長)にする
function parseMotifSize_(text) {
  var numbers = String(text || "").match(/\d+(?:\.\d+)?/g);
  if (!numbers) return null;
  var values = numbers.slice(0, 2).map(function (n) { return Math.round(Number(n) * 100) / 10; });
  if (values.length === 1) values.push(values[0]);
  values.sort(function (x, y) { return y - x; });
  return values.every(function (v) { return v >= 1 && v <= 200; }) ? values : null;
}

function fetchMotifSize_(product) {
  try {
    var response = UrlFetchApp.fetch("https://japan.mango.com/commodity/json/" + product.shop + "/" + product.code + "/measurement", {
      method: "post",
      muteHttpExceptions: true,
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    if (response.getResponseCode() !== 200) return null;
    var data = JSON.parse(response.getContentText());
    var headers = data.headers || [];
    var row = (data.rows || [])[0];
    if (!row) return null;
    for (var i = 0; i < headers.length; i += 1) {
      if (/モチーフ|motif/i.test(String(headers[i].labelJa || "") + String(headers[i].key || ""))) {
        var text = (row.values || [])[i];
        return { text: String(text || ""), label: headers[i].labelJa || "モチーフのサイズ", sizes: parseMotifSize_(text) };
      }
    }
  } catch (error) {
    console.error(error);
  }
  return null;
}

function fetchProductPage_(product) {
  var response = UrlFetchApp.fetch(product.url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) fail_("商品ページを読み込めませんでした(" + response.getResponseCode() + ")。URLを確認してください。");
  var html = response.getContentText();
  var title = html.match(/property="og:title"\s+content="([^"]*)"/i) || html.match(/<title>([^<]*)<\/title>/i);
  return { html: html, name: title ? decodeHtml_(title[1]).replace(/\s+/g, " ").replace(/\s*\|\s*MANGO.*$/i, "").trim().slice(0, 120) : "" };
}

// 商品ページから、画像(1〜2枚目)とモチーフのサイズを取得する。AIは使わない
function earringInfo_(parsed) {
  var product = parseJapanProductUrl_(parsed.url);
  var page = fetchProductPage_(product);
  var images = earringImageUrls_(page.html, product.code);
  if (!images.length) fail_("商品ページから画像を取得できませんでした。");
  var motif = fetchMotifSize_(product);
  return {
    ok: true,
    url: product.url,
    name: page.name,
    images: images,
    sizeLabel: motif ? motif.label : "",
    sizeText: motif ? motif.text : "",
    heightMm: motif && motif.sizes ? motif.sizes[0] : null,
    widthMm: motif && motif.sizes ? motif.sizes[1] : null
  };
}

function imagePart_(url) {
  if (!/^https:\/\/[a-z0-9.-]*locondo\.jp\//i.test(url)) fail_("画像の取得先が正しくありません。");
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) fail_("商品画像を取得できませんでした。");
  var blob = response.getBlob();
  var mime = blob.getContentType() || "image/jpeg";
  return { inline_data: { mime_type: /^image\/(jpeg|png|webp)$/.test(mime) ? mime : "image/jpeg", data: Utilities.base64Encode(blob.getBytes()) } };
}

function earringGenerate_(parsed) {
  var heightMm = Number(parsed.heightMm);
  var widthMm = Number(parsed.widthMm);
  if (!(heightMm >= 1 && heightMm <= 200 && widthMm >= 1 && widthMm <= 200)) fail_("サイズは1〜200mmで入力してください。");
  var product = parseJapanProductUrl_(parsed.url);

  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty("GEMINI_API_KEY");
  if (!key) fail_("サーバーにGEMINI_API_KEYが設定されていません。");
  var model = props.getProperty("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;

  var page = fetchProductPage_(product);
  var imageUrls = earringImageUrls_(page.html, product.code);
  if (!imageUrls.length) fail_("商品ページから画像を取得できませんでした。");
  var parts = [{ text: earringPrompt_(Math.round(heightMm * 10) / 10, Math.round(widthMm * 10) / 10) }].concat(imageUrls.map(imagePart_));

  var remaining = reserveEarringQuota_();
  if (remaining === null) fail_("本日の生成回数の上限(" + EARRING_DAILY_LIMIT + "回)に達しました。明日またお試しください。");

  try {
    var response = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      headers: { "x-goog-api-key": key },
      payload: JSON.stringify({ contents: [{ parts: parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } })
    });
    var code = response.getResponseCode();
    if (code !== 200) {
      console.error("Gemini error " + code + ": " + response.getContentText().slice(0, 500));
      if (code === 429) fail_("AIの利用が集中しています。しばらくしてからもう一度お試しください。");
      fail_("画像を生成できませんでした(" + code + ")。");
    }
    var data = JSON.parse(response.getContentText());
    var outParts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    for (var i = 0; i < outParts.length; i += 1) {
      var inline = outParts[i].inlineData || outParts[i].inline_data;
      if (inline && inline.data) {
        return { ok: true, image: inline.data, mime: inline.mimeType || inline.mime_type || "image/png", remaining: remaining };
      }
    }
    fail_("画像を生成できませんでした。別の商品でお試しください。");
  } catch (error) {
    refundEarringQuota_();
    throw error;
  }
}

// 他の操作(確認済の保存など)を止めないよう、全体のロックは使わない
function handleEarring_(e) {
  try {
    var body = e.postData.contents;
    if (body.length > 5000) fail_("データが大きすぎます。");
    var parsed;
    try { parsed = JSON.parse(body); } catch (error) { fail_("JSONの形式が正しくありません。"); }
    if (parsed.action === "earringInfo") return json_(earringInfo_(parsed));
    if (parsed.action === "earring") return json_(earringGenerate_(parsed));
    fail_("操作が正しくありません。");
  } catch (error) {
    if (error && error.validation) return json_({ ok: false, error: error.message });
    console.error(error);
    return json_({ ok: false, error: "サーバーエラーが発生しました。" });
  }
}

function doPost(e) {
  if (isEarringRequest_(e)) return handleEarring_(e);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: "混み合っています。少し待ってからもう一度お試しください。" });
  try {
    return json_(handle_(e));
  } catch (error) {
    if (error && error.validation) return json_({ ok: false, error: error.message });
    console.error(error);
    return json_({ ok: false, error: "サーバーエラーが発生しました。" });
  } finally {
    lock.releaseLock();
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(message) {
  var error = new Error(message);
  error.validation = true;
  throw error;
}

function str_(value, max) {
  return typeof value === "string" && value.length <= max ? value : null;
}

function code8_(value) {
  return typeof value === "string" && /^\d{8}$/.test(value) ? value : null;
}

function color_(value) {
  return typeof value === "string" && /^[A-Za-z0-9]{1,4}$/.test(value) ? value : null;
}

function httpsUrl_(value, hostOk, pathOk) {
  if (typeof value !== "string" || value.length > 1000) return null;
  var match = value.match(/^https:\/\/([a-z0-9.-]+)(\/[^\s"'<>\\]*)?$/i);
  if (!match) return null;
  var host = match[1].toLowerCase();
  var path = match[2] || "/";
  if (!hostOk(host) || (pathOk && !pathOk(path))) return null;
  return value;
}

function isMangoHost_(host) {
  return host === "mango.com" || /\.mango\.com$/.test(host) || host === "mngbcn.com" || /\.mngbcn\.com$/.test(host);
}

function cleanProduct_(value, withRelated) {
  if (!value || typeof value !== "object") return null;
  var productNumber = code8_(value.productNumber);
  var colorId = color_(value.colorId);
  var name = str_(value.name, 200);
  var url = httpsUrl_(value.url, function (host) { return host === "shop.mango.com"; }, function (path) { return path.indexOf("/gb/en/p/") === 0; });
  var image = value.image ? httpsUrl_(value.image, isMangoHost_) : "";
  if (!productNumber || !colorId || !name || !url || image === null) return null;
  var product = {
    name: name,
    image: image,
    productNumber: productNumber,
    baseCode: productNumber,
    globalCode: productNumber,
    colorId: colorId,
    url: url
  };
  var colorName = str_(value.colorName, 60);
  if (colorName) product.colorName = colorName;
  if (withRelated) {
    var related = Array.isArray(value.relatedProductNumbers) ? value.relatedProductNumbers.slice(0, 24) : [];
    product.relatedProductNumbers = related
      .map(function (entry) {
        return { productNumber: entry ? code8_(entry.productNumber) : null, colorId: entry ? color_(entry.colorId) : null };
      })
      .filter(function (entry) { return entry.productNumber && entry.colorId; });
  }
  return product;
}

function cleanRaw_(raw, now) {
  if (!raw || !Array.isArray(raw.products) || typeof raw.candidates !== "object" || raw.candidates === null) {
    fail_("データの形式が正しくありません。");
  }
  if (raw.products.length > MAX_PRODUCTS) fail_("商品数が多すぎます。");
  var products = raw.products.map(function (product) { return cleanProduct_(product, true); }).filter(Boolean);
  if (products.length < MIN_PRODUCTS) fail_("有効な商品が少なすぎます(" + products.length + "件)。");

  var keys = Object.keys(raw.candidates);
  if (keys.length > MAX_CANDIDATES) fail_("関連候補が多すぎます。");
  var candidates = {};
  keys.forEach(function (key) {
    if (!/^\d{8}:[A-Za-z0-9]{1,4}$/.test(key)) return;
    var value = raw.candidates[key];
    candidates[key] = value === null ? null : cleanProduct_(value, false);
  });
  return { collectedAt: now.toISOString(), products: products, candidates: candidates };
}

function github_(path, options) {
  return githubRequest_("https://api.github.com/repos/" + OWNER + "/" + REPO + "/contents/" + path, options);
}

function githubRequest_(url, options) {
  options = options || {};
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) fail_("サーバーにGITHUB_TOKENが設定されていません。");
  var request = {
    method: options.method || "get",
    muteHttpExceptions: true,
    headers: {
      Authorization: "Bearer " + token,
      Accept: options.accept || "application/vnd.github+json",
      "User-Agent": "mango-finder-relay"
    }
  };
  if (options.payload) {
    request.contentType = "application/json";
    request.payload = JSON.stringify(options.payload);
  }
  return UrlFetchApp.fetch(url, request);
}

function startCrawl_() {
  var props = PropertiesService.getScriptProperties();
  var last = Number(props.getProperty(CRAWL_KEY) || 0);
  var now = Date.now();
  if (last && now - last < CRAWL_INTERVAL_MS) return { ok: true, running: true, startedAt: new Date(last).toISOString() };
  var response = githubRequest_("https://api.github.com/repos/" + OWNER + "/" + REPO + "/actions/workflows/" + CRAWL_WORKFLOW + "/dispatches", {
    method: "post",
    payload: { ref: BRANCH }
  });
  var code = response.getResponseCode();
  if (code === 403 || code === 404) fail_("更新を開始できませんでした。GITHUB_TOKENに Actions: Read and write の権限を追加してください。");
  if (code !== 204) fail_("更新を開始できませんでした(" + code + ")。");
  props.setProperty(CRAWL_KEY, String(now));
  return { ok: true, running: false, startedAt: new Date(now).toISOString() };
}

function readCurrent_() {
  var meta = github_(FILE_PATH + "?ref=" + BRANCH);
  if (meta.getResponseCode() === 404) return { sha: undefined, previous: null };
  if (meta.getResponseCode() !== 200) throw new Error("GitHub read failed: " + meta.getResponseCode());
  var sha = JSON.parse(meta.getContentText()).sha;
  var previous = null;
  var rawResponse = github_(FILE_PATH + "?ref=" + BRANCH, { accept: "application/vnd.github.raw+json" });
  if (rawResponse.getResponseCode() === 200) {
    try { previous = JSON.parse(rawResponse.getContentText()); } catch (error) { previous = null; }
  }
  return { sha: sha, previous: previous };
}

function handle_(e) {
  var body = e && e.postData ? e.postData.contents : "";
  if (!body) fail_("データがありません。");
  if (body.length > MAX_BODY_CHARS) fail_("データが大きすぎます。");
  var parsed;
  try { parsed = JSON.parse(body); } catch (error) { fail_("JSONの形式が正しくありません。"); }

  if (parsed && parsed.action === "check") return setChecked_(parsed);
  if (parsed && parsed.action === "crawl") return startCrawl_();

  var now = new Date();
  var raw = cleanRaw_(parsed && parsed.raw, now);
  var current = readCurrent_();
  var previous = current.previous;

  if (previous && previous.collectedAt) {
    var elapsed = now.getTime() - new Date(previous.collectedAt).getTime();
    if (elapsed < MIN_INTERVAL_MS) {
      fail_("直前に更新されています。" + Math.ceil((MIN_INTERVAL_MS - elapsed) / 60000) + "分後にもう一度お試しください。");
    }
  }
  if (previous && previous.products && previous.products.length && raw.products.length < previous.products.length * 0.5) {
    fail_("商品数が前回(" + previous.products.length + "件)の半分未満のため、不完全な収集として受け付けませんでした。");
  }

  var save = github_(FILE_PATH, {
    method: "put",
    payload: {
      message: "chore: update global raw data",
      content: Utilities.base64Encode(JSON.stringify(raw), Utilities.Charset.UTF_8),
      sha: current.sha,
      branch: BRANCH
    }
  });
  if (save.getResponseCode() !== 200 && save.getResponseCode() !== 201) {
    fail_("GitHubへの保存に失敗しました(" + save.getResponseCode() + ")。");
  }
  return { ok: true, products: raw.products.length };
}
