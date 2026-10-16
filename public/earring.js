(function () {
  const root = document.getElementById("earringView");
  if (!root) return;

  const $ = (id) => document.getElementById(id);
  const urlInput = $("earringUrl");
  const loadButton = $("earringLoad");
  const status = $("earringStatus");
  const product = $("earringProduct");
  const nameLabel = $("earringName");
  const images = $("earringImages");
  const sizeNote = $("earringSizeNote");
  const heightInput = $("earringHeight");
  const widthInput = $("earringWidth");
  const generate = $("earringGenerate");
  const result = $("earringResult");
  const resultImage = $("earringResultImage");
  const download = $("earringDownload");

  let loaded = null;
  let busy = false;

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  };

  const setBusy = (value) => {
    busy = value;
    loadButton.disabled = value;
    generate.disabled = value;
  };

  async function callRelay(request) {
    const response = await fetch(GLOBAL_RELAY_URL, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=utf-8" },
      body: JSON.stringify(request)
    });
    const body = await response.json();
    if (!body.ok) throw new Error(body.error || "処理できませんでした。");
    return body;
  }

  function readSize(input, label) {
    const value = Number(input.value);
    if (!input.value || !Number.isFinite(value) || value < 1 || value > 200) throw new Error(`${label}は1〜200mmで入力してください。`);
    return Math.round(value * 10) / 10;
  }

  async function loadProduct() {
    if (busy) return;
    const url = urlInput.value.trim();
    if (!url) {
      setStatus("商品URLを入力してください。", true);
      return;
    }
    setBusy(true);
    loadButton.textContent = "読み込み中…";
    product.hidden = true;
    result.hidden = true;
    setStatus("商品ページを読み込んでいます…");
    try {
      const info = await callRelay({ action: "earringInfo", url });
      loaded = info;
      nameLabel.textContent = info.name || "商品";
      images.replaceChildren(...info.images.map((src) => {
        const image = document.createElement("img");
        image.src = src;
        image.alt = info.name || "商品画像";
        return image;
      }));
      heightInput.value = info.heightMm ?? "";
      widthInput.value = info.widthMm ?? "";
      sizeNote.textContent = info.sizeText
        ? `商品ページの「${info.sizeLabel}」: ${info.sizeText} cm を、大きい方を縦・小さい方を横として入力しました。実際の向きと違う場合は直してください。`
        : "商品ページにモチーフのサイズが見つかりませんでした。縦と横(mm)を入力してください。";
      product.hidden = false;
      setStatus("");
    } catch (error) {
      loaded = null;
      setStatus(`読み込めませんでした: ${error.message}`, true);
    }
    loadButton.textContent = "読み込む";
    setBusy(false);
  }

  async function generateImage() {
    if (busy || !loaded) return;
    let heightMm;
    let widthMm;
    try {
      heightMm = readSize(heightInput, "縦");
      widthMm = readSize(widthInput, "横");
    } catch (error) {
      setStatus(error.message, true);
      return;
    }
    setBusy(true);
    generate.textContent = "生成中…";
    result.hidden = true;
    setStatus("生成しています。20〜40秒ほどかかります。");
    try {
      const body = await callRelay({ action: "earring", url: loaded.url, heightMm, widthMm });
      const mime = body.mime || "image/png";
      resultImage.src = `data:${mime};base64,${body.image}`;
      download.href = resultImage.src;
      const code = loaded.url.split("/").filter(Boolean).pop() || "earring";
      download.download = `${code}_worn.${mime.includes("jpeg") ? "jpg" : "png"}`;
      result.hidden = false;
      setStatus(body.remaining === undefined ? "生成しました。" : `生成しました。本日の残り回数: ${body.remaining}回`);
    } catch (error) {
      setStatus(`生成に失敗しました: ${error.message}`, true);
    }
    generate.textContent = "着用画像を生成";
    setBusy(false);
  }

  loadButton.addEventListener("click", loadProduct);
  urlInput.addEventListener("keydown", (event) => { if (event.key === "Enter") loadProduct(); });
  generate.addEventListener("click", generateImage);
})();
