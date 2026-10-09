const { chromium } = require("playwright");

const mode = process.argv[2];
const SEARCH = "https://shop.mango.com/gb/en/search/women";
const API = "https://online-orchestrator.mango.com/v4/products?channelId=shop&countryIso=GB&languageIso=en&productId=";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "en-GB",
    timezoneId: "Europe/London",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(SEARCH, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(8000);
    const html = await page.content();
    const links = new Set([...html.replace(/\u002f|\\//gi, "/").matchAll(/\/gb\/en\/p\/[^\s"'<>\]+/gi)].map((m) => m[0]));
    const blocked = /Security Checkpoint|Access Denied|captcha/i.test(html);
    console.log(`status=${response && response.status()} title=${await page.title()} blocked=${blocked} productLinks=${links.size}`);
    if (mode === "page") {
      if (blocked || !links.size) process.exitCode = 1;
    } else if (mode === "api") {
      const result = await page.evaluate(async (url) => {
        const r = await fetch(url + "77070355");
        return { status: r.status, length: (await r.text()).length };
      }, API);
      console.log(`api status=${result.status} length=${result.length}`);
      if (result.status !== 200) process.exitCode = 1;
    }
  } catch (error) {
    console.log(`error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
