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

  function normalizeJapaneseName(value) {
    return String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  }

  function japanItemForGlobal(globalProduct, japanProducts) {
    const globalCode = normalizeBrandBaseCode(globalProduct.baseCode || globalProduct.productNumber);
    const normalizeColor = (value) => String(value || "").toUpperCase().replace(/^0+(?=\d)/, "");
    const globalColor = normalizeColor(globalProduct.colorId);
    if (!globalCode || !globalColor) return null;
    return japanProducts.find((item) => {
      const brandMatch = String(item.brandItemNumber || "").match(/(\d{8})\s+([A-Z0-9]+)/i);
      if (!brandMatch) return false;
      const itemCode = brandMatch[1];
      const sameCode = itemCode === globalCode || itemCode.slice(-7) === globalCode.slice(-7);
      return sameCode && normalizeColor(brandMatch[2]) === globalColor;
    }) || null;
  }

  function japanProductUrlForGlobal(globalProduct, japanProducts) {
    return japanItemForGlobal(globalProduct, japanProducts)?.url || "";
  }

  // 日本サイトの商品ページで、すでに互いを関連商品として表示しているか
  function relatedOnJapan(itemA, itemB) {
    if (!itemA || !itemB) return false;
    const nameA = normalizeJapaneseName(itemA.name);
    const nameB = normalizeJapaneseName(itemB.name);
    const listed = (item, name) => name && (item.relatedNames || []).some((related) => normalizeJapaneseName(related) === name);
    return listed(itemA, nameB) || listed(itemB, nameA);
  }

  // raw: { products: [...], candidates: { "<productNumber>:<colorId>": product | null } }
  function buildGlobalResult(raw, japanProducts, now = new Date()) {
    const candidates = raw.candidates || {};
    const deduped = (raw.products || []).filter((product, index, array) =>
      product.baseCode && array.findIndex((entry) => entry.baseCode === product.baseCode) === index);

    const matches = deduped.map((globalProduct) => {
      const mainItem = japanItemForGlobal(globalProduct, japanProducts);
      const japanUrl = mainItem?.url || "";
      const related = (globalProduct.relatedProductNumbers || [])
        .map((entry) => candidates[`${entry.productNumber}:${entry.colorId}`])
        .filter(Boolean)
        .filter((candidate) => candidate.baseCode !== globalProduct.baseCode || candidate.colorId !== globalProduct.colorId)
        .filter((candidate, index, list) => list.findIndex((entry) => entry.baseCode === candidate.baseCode) === index)
        .map(({ relatedUrls, relatedProductNumbers, ...candidate }) => {
          const candidateItem = japanItemForGlobal(candidate, japanProducts);
          return { ...candidate, japanUrl: candidateItem?.url || "", alreadyRelated: relatedOnJapan(mainItem, candidateItem) };
        })
        .filter((candidate) => candidate.japanUrl && !candidate.alreadyRelated)
        .map(({ alreadyRelated, ...candidate }) => candidate);
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
