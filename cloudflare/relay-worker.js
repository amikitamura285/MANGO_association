// Cloudflare Worker: ブラウザで収集したMANGOグローバル商品データを検証し、data/global-raw.json としてコミットする。
// Secret: GITHUB_TOKEN (Fine-grained token / このリポジトリの Contents: Read and write)
const OWNER = "amikitamura285";
const REPO = "MANGO_association";
const BRANCH = "main";
const FILE_PATH = "data/global-raw.json";
const ALLOWED_ORIGIN = "https://amikitamura285.github.io";
const MAX_BODY_BYTES = 3_000_000;
const MIN_INTERVAL_MS = 10 * 60 * 1000;
const MIN_PRODUCTS = 10;
const MAX_PRODUCTS = 300;
const MAX_CANDIDATES = 4000;

class ValidationError extends Error {}

const cors = {
  "access-control-allow-origin": ALLOWED_ORIGIN,
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400"
};

const reply = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "content-type": "application/json; charset=utf-8" }
});

const text = (value, max) => (typeof value === "string" && value.length <= max ? value : null);
const code8 = (value) => (typeof value === "string" && /^\d{8}$/.test(value) ? value : null);
const colorCode = (value) => (typeof value === "string" && /^[A-Za-z0-9]{1,4}$/.test(value) ? value : null);

function httpsUrl(value, hostOk, pathOk = () => true) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !hostOk(url.hostname) || !pathOk(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}

const isMangoHost = (host) => host === "mango.com" || host.endsWith(".mango.com") || host === "mngbcn.com" || host.endsWith(".mngbcn.com");

function cleanProduct(value, { withRelated }) {
  const productNumber = code8(value?.productNumber);
  const colorId = colorCode(value?.colorId);
  const name = text(value?.name, 200);
  const url = httpsUrl(value?.url, (host) => host === "shop.mango.com", (path) => path.startsWith("/gb/en/p/"));
  const image = value?.image ? httpsUrl(value.image, isMangoHost) : "";
  if (!productNumber || !colorId || !name || !url || image === null) return null;
  const product = {
    name,
    image,
    productNumber,
    baseCode: productNumber,
    globalCode: productNumber,
    colorId,
    url
  };
  const colorName = text(value?.colorName, 60);
  if (colorName) product.colorName = colorName;
  if (withRelated) {
    const related = Array.isArray(value.relatedProductNumbers) ? value.relatedProductNumbers.slice(0, 24) : [];
    product.relatedProductNumbers = related
      .map((entry) => ({ productNumber: code8(entry?.productNumber), colorId: colorCode(entry?.colorId) }))
      .filter((entry) => entry.productNumber && entry.colorId);
  }
  return product;
}

function cleanRaw(raw, now) {
  if (!raw || !Array.isArray(raw.products) || typeof raw.candidates !== "object" || raw.candidates === null) {
    throw new ValidationError("データの形式が正しくありません。");
  }
  if (raw.products.length > MAX_PRODUCTS) throw new ValidationError("商品数が多すぎます。");
  const products = raw.products.map((product) => cleanProduct(product, { withRelated: true })).filter(Boolean);
  if (products.length < MIN_PRODUCTS) throw new ValidationError(`有効な商品が少なすぎます(${products.length}件)。`);

  const entries = Object.entries(raw.candidates);
  if (entries.length > MAX_CANDIDATES) throw new ValidationError("関連候補が多すぎます。");
  const candidates = {};
  for (const [key, value] of entries) {
    if (!/^\d{8}:[A-Za-z0-9]{1,4}$/.test(key)) continue;
    candidates[key] = value === null ? null : cleanProduct(value, { withRelated: false });
  }
  return { collectedAt: now.toISOString(), products, candidates };
}

async function github(env, path, init = {}) {
  return fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "mango-finder-relay",
      ...init.headers
    }
  });
}

async function readCurrent(env) {
  const meta = await github(env, `${FILE_PATH}?ref=${BRANCH}`);
  if (meta.status === 404) return { sha: undefined, previous: null };
  if (!meta.ok) throw new Error(`GitHub read failed: ${meta.status}`);
  const sha = (await meta.json()).sha;
  const rawResponse = await github(env, `${FILE_PATH}?ref=${BRANCH}`, { headers: { accept: "application/vnd.github.raw+json" } });
  let previous = null;
  if (rawResponse.ok) {
    try { previous = await rawResponse.json(); } catch { previous = null; }
  }
  return { sha, previous };
}

const toBase64 = (value) => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply(405, { error: "POST only" });
    if (request.headers.get("origin") !== ALLOWED_ORIGIN) return reply(403, { error: "許可されていないオリジンです。" });
    if (!env.GITHUB_TOKEN) return reply(500, { error: "サーバーにGITHUB_TOKENが設定されていません。" });

    const body = await request.text();
    if (body.length > MAX_BODY_BYTES) return reply(413, { error: "データが大きすぎます。" });

    try {
      const now = new Date();
      let parsed;
      try { parsed = JSON.parse(body); } catch { throw new ValidationError("JSONの形式が正しくありません。"); }
      const raw = cleanRaw(parsed?.raw, now);
      const { sha, previous } = await readCurrent(env);

      if (previous?.collectedAt) {
        const elapsed = now.getTime() - new Date(previous.collectedAt).getTime();
        if (elapsed < MIN_INTERVAL_MS) {
          return reply(429, { error: `直前に更新されています。${Math.ceil((MIN_INTERVAL_MS - elapsed) / 60000)}分後にもう一度お試しください。` });
        }
      }
      if (previous?.products?.length && raw.products.length < previous.products.length * 0.5) {
        return reply(422, { error: `商品数が前回(${previous.products.length}件)の半分未満のため、不完全な収集として受け付けませんでした。` });
      }

      const save = await github(env, FILE_PATH, {
        method: "PUT",
        body: JSON.stringify({
          message: "chore: update global raw data",
          content: toBase64(JSON.stringify(raw)),
          sha,
          branch: BRANCH
        })
      });
      if (!save.ok) return reply(502, { error: `GitHubへの保存に失敗しました(${save.status})。` });
      return reply(200, { ok: true, products: raw.products.length });
    } catch (error) {
      if (error instanceof ValidationError) return reply(400, { error: error.message });
      return reply(500, { error: "サーバーエラーが発生しました。" });
    }
  }
};
