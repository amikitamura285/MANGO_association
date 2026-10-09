(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GlobalMatch = factory();
})(typeof self !== "undefined" ? self : this, function () {
  function normalizeComparisonName(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function normalizeBrandBaseCode(value) {
    const match = String(value || "").match(/(\d{8})/);
    return match ? match[1] : "";
  }

  function japanProductUrlForGlobal(globalProduct, japanProducts) {
    const globalCode = normalizeBrandBaseCode(globalProduct.baseCode || globalProduct.productNumber);
    const globalColor = String(globalProduct.colorId || "").toUpperCase();
    if (!globalCode || !globalColor) return "";
    const match = japanProducts.find((item) => {
      const brandMatch = String(item.brandItemNumber || "").match(/(\d{8})\s+([A-Z0-9]+)/i);
      if (!brandMatch) return false;
      const itemCode = brandMatch[1];
      const sameCode = itemCode === globalCode || itemCode.slice(-7) === globalCode.slice(-7);
      return sameCode && brandMatch[2].toUpperCase() === globalColor;
    });
    return match?.url || "";
  }

  // raw: { products: [...], candidates: { "<productNumber>:<colorId>": product | null } }
  function buildGlobalResult(raw, japanProducts, now = new Date()) {
    const candidates = raw.candidates || {};
    const registeredNames = new Set();
    for (const item of japanProducts) {
      for (const name of item.relatedNames || []) registeredNames.add(normalizeComparisonName(name));
    }

    const deduped = (raw.products || []).filter((product, index, array) =>
      product.baseCode && array.findIndex((entry) => entry.baseCode === product.baseCode) === index);

    const matches = deduped.map((globalProduct) => {
      const related = (globalProduct.relatedProductNumbers || [])
        .map((entry) => candidates[`${entry.productNumber}:${entry.colorId}`])
        .filter(Boolean)
        .filter((candidate) => candidate.baseCode !== globalProduct.baseCode || candidate.colorId !== globalProduct.colorId)
        .filter((candidate) => !registeredNames.has(normalizeComparisonName(candidate.name)))
        .filter((candidate, index, list) => list.findIndex((entry) => entry.baseCode === candidate.baseCode) === index)
        .map(({ relatedUrls, relatedProductNumbers, ...candidate }) => ({
          ...candidate,
          japanUrl: japanProductUrlForGlobal(candidate, japanProducts)
        }))
        .filter((candidate) => candidate.japanUrl);
      const japanUrl = japanProductUrlForGlobal(globalProduct, japanProducts);
      return {
        main: { ...globalProduct, japanUrl },
        relatedGlobal: related,
        baseCode: globalProduct.baseCode,
        hasJapanRelations: Boolean(japanUrl && related.length)
      };
    }).filter((entry) => entry.hasJapanRelations);

    // 同じページ内で、先に表示した商品(メイン/候補とも)は後のグループに出さない
    const shown = new Set();
    const uniqueMatches = [];
    for (const entry of matches) {
      if (shown.has(entry.baseCode)) continue;
      const relatedGlobal = entry.relatedGlobal.filter((candidate) => !shown.has(candidate.baseCode));
      if (!relatedGlobal.length) continue;
      shown.add(entry.baseCode);
      relatedGlobal.forEach((candidate) => shown.add(candidate.baseCode));
      uniqueMatches.push({ ...entry, relatedGlobal });
    }

    return {
      updatedAt: now.toISOString(),
      products: deduped.map(({ relatedUrls, ...product }) => product).slice(0, 200),
      matches: uniqueMatches
    };
  }

  return { buildGlobalResult, japanProductUrlForGlobal, normalizeComparisonName, normalizeBrandBaseCode };
});
