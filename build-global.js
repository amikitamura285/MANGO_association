const fs = require("node:fs");
const path = require("node:path");
const { buildGlobalResult } = require("./public/tools/global-match.js");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

const raw = readJson("data/global-raw.json");
const japan = readJson("public/japan-index.json");
if (!raw || !japan) {
  console.log("Skipped: data/global-raw.json or public/japan-index.json is missing.");
  process.exit(0);
}

const result = buildGlobalResult(raw, japan.products || []);
if (!result.matches.length) {
  console.warn("No matches built; keeping existing global-products.json.");
  process.exit(0);
}

for (const file of ["public/global-products.json", "data/global-products.json"]) {
  fs.writeFileSync(path.join(__dirname, file), JSON.stringify(result, null, 2), "utf8");
}
console.log(`Built global-products.json: ${result.matches.length} matches / ${result.products.length} products.`);
