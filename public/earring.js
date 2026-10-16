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
  const promptBox = $("earringPrompt");
  const copyButton = $("earringCopy");
  const modelUrlInput = $("earringModelUrl");
  const modelLoadButton = $("earringModelLoad");
  const modelStatus = $("earringModelStatus");
  const modelImages = $("earringModelImages");

  let loaded = null;
  let busy = false;
  let modelBusy = false;

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  };

  const setModelStatus = (text, isError = false) => {
    modelStatus.textContent = text;
    modelStatus.classList.toggle("is-error", isError);
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

  const fmt = (value) => (Number.isFinite(value) && value > 0 ? String(Math.round(value * 10) / 10) : "?");

  function buildPrompt() {
    const height = fmt(Number(heightInput.value) / 10);
    const width = fmt(Number(widthInput.value) / 10);
    return [
      "次はこの写真のピアスの着用画像を生成して。質感も忠実に。",
      `ピアスのサイズ：横${width}cm×縦${height}cm`,
      "モデル：添付の着用写真を参考に、服の色は変更なし"
    ].join("\n");
  }

  const refreshPrompt = () => { promptBox.value = buildPrompt(); };

  function saveBlob(base64, mime, name) {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([bytes], { type: mime }));
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  // 商品ページの画像を、中継サーバー経由で保存する
  async function saveImage(pageUrl, index, prefix, button, report) {
    button.disabled = true;
    const label = button.textContent;
    button.textContent = "取得中…";
    try {
      const body = await callRelay({ action: "earringImage", url: pageUrl, index });
      const code = pageUrl.split("/").filter(Boolean).pop() || "image";
      const ext = body.mime.includes("png") ? "png" : body.mime.includes("webp") ? "webp" : "jpg";
      saveBlob(body.image, body.mime, `${prefix}${code}_${index + 1}.${ext}`);
    } catch (error) {
      report(`画像を保存できませんでした: ${error.message}`, true);
    }
    button.textContent = label;
    button.disabled = false;
  }

  function renderImages(container, info, prefix, report) {
    container.replaceChildren(...info.images.map((src, index) => {
      const figure = document.createElement("figure");
      const image = document.createElement("img");
      image.src = src;
      image.alt = info.name || "商品画像";
      const caption = document.createElement("figcaption");
      caption.textContent = `${index + 1}枚目`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "画像を保存";
      button.addEventListener("click", () => saveImage(info.url, index, prefix, button, report));
      figure.append(image, caption, button);
      return figure;
    }));
  }

  async function loadProduct() {
    if (busy) return;
    const url = urlInput.value.trim();
    if (!url) {
      setStatus("商品URLを入力してください。", true);
      return;
    }
    busy = true;
    loadButton.disabled = true;
    loadButton.textContent = "読み込み中…";
    product.hidden = true;
    setStatus("商品ページを読み込んでいます…");
    try {
      const info = await callRelay({ action: "earringInfo", url });
      loaded = info;
      nameLabel.textContent = info.name || "商品";
      renderImages(images, info, "earring_", setStatus);
      heightInput.value = info.heightMm ?? "";
      widthInput.value = info.widthMm ?? "";
      sizeNote.textContent = info.sizeText
        ? `商品ページの「${info.sizeLabel}」: ${info.sizeText} cm を、大きい方を縦・小さい方を横として入力しました。実際の向きと違う場合は直してください。`
        : "商品ページにモチーフのサイズが見つかりませんでした。縦と横(mm)を入力してください。";
      refreshPrompt();
      product.hidden = false;
      setStatus("");
    } catch (error) {
      loaded = null;
      setStatus(`読み込めませんでした: ${error.message}`, true);
    }
    loadButton.textContent = "読み込む";
    loadButton.disabled = false;
    busy = false;
  }

  async function loadModel() {
    if (modelBusy) return;
    const url = modelUrlInput.value.trim();
    if (!url) {
      setModelStatus("モデル写真用の商品URLを入力してください。", true);
      return;
    }
    modelBusy = true;
    modelLoadButton.disabled = true;
    modelLoadButton.textContent = "読み込み中…";
    modelImages.replaceChildren();
    setModelStatus("読み込んでいます…");
    try {
      const info = await callRelay({ action: "earringModel", url });
      renderImages(modelImages, info, "model_", setModelStatus);
      setModelStatus(`${info.name || "商品"} の画像です。顔が写っている写真を保存してください。`);
    } catch (error) {
      setModelStatus(`読み込めませんでした: ${error.message}`, true);
    }
    modelLoadButton.textContent = "写真を読み込む";
    modelLoadButton.disabled = false;
    modelBusy = false;
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(promptBox.value);
    } catch (error) {
      promptBox.select();
      document.execCommand("copy");
    }
    copyButton.textContent = "コピーしました";
    setTimeout(() => { copyButton.textContent = "指示文をコピー"; }, 1500);
  }

  loadButton.addEventListener("click", loadProduct);
  urlInput.addEventListener("keydown", (event) => { if (event.key === "Enter") loadProduct(); });
  modelLoadButton.addEventListener("click", loadModel);
  modelUrlInput.addEventListener("keydown", (event) => { if (event.key === "Enter") loadModel(); });
  [heightInput, widthInput].forEach((input) => input.addEventListener("input", refreshPrompt));
  copyButton.addEventListener("click", copyPrompt);
})();
