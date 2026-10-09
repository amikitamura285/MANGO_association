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

    return {
      updatedAt: now.toISOString(),
      products: deduped.map(({ relatedUrls, ...product }) => product).slice(0, 200),
      matches
    };
  }

  // 過去に表示した商品(main.productNumber)は候補から外し、新しく出てきたものだけを matches に残す。
  // 同じ収集データ(rawCollectedAt)の再構築では、そのデータを処理する前の履歴を基準にして結果を再現する。
  function applyDisplayHistory(result, rawCollectedAt, existing) {
    let baseline = [];
    if (existing) {
      if (rawCollectedAt && existing.rawCollectedAt === rawCollectedAt) {
        baseline = existing.previousDisplayedMainProductNumbers || [];
      } else {
        baseline = existing.displayedMainProductNumbers
          || (existing.matches || []).map((entry) => entry.main && entry.main.productNumber).filter(Boolean);
      }
    }
    const seen = new Set(baseline);
    const matches = result.matches.filter((entry) => !seen.has(entry.main.productNumber));
    return {
      ...result,
      matches,
      totalMatches: result.matches.length,
      rawCollectedAt: rawCollectedAt || null,
      previousDisplayedMainProductNumbers: baseline,
      displayedMainProductNumbers: [...new Set([...baseline, ...matches.map((entry) => entry.main.productNumber)])]
    };
  }

  return { buildGlobalResult, applyDisplayHistory, japanProductUrlForGlobal, normalizeComparisonName, normalizeBrandBaseCode };
});
