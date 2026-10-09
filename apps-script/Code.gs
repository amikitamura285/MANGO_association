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
var CRAWL_WORKFLOW = "crawl.yml";
var CRAWL_KEY = "LAST_CRAWL_AT";
var CRAWL_INTERVAL_MS = 15 * 60 * 1000;

function doGet(e) {
  if (e && e.parameter && e.parameter.action === "checked") return json_({ ok: true, checked: readChecked_() });
  return json_({ ok: true, message: "MANGO FINDER relay" });
}

function readChecked_() {
  try {
    var list = JSON.parse(PropertiesService.getScriptProperties().getProperty(CHECKED_KEY) || "[]");
    return Array.isArray(list) ? list.filter(function (code) { return code8_(code); }) : [];
  } catch (error) {
    return [];
  }
}

function writeChecked_(list) {
  PropertiesService.getScriptProperties().setProperty(CHECKED_KEY, JSON.stringify(list.slice(-MAX_CHECKED)));
}

function setChecked_(parsed) {
  var code = code8_(parsed.productNumber);
  if (!code || typeof parsed.checked !== "boolean") fail_("確認済の指定が正しくありません。");
  var list = readChecked_().filter(function (entry) { return entry !== code; });
  if (parsed.checked) list.push(code);
  writeChecked_(list);
  return { ok: true, checked: list.slice(-MAX_CHECKED) };
}

function doPost(e) {
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
