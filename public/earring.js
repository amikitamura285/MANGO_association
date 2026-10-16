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

  let loaded = null;
  let busy = false;

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
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
    const height = fmt(Number(heightInput.value));
    const width = fmt(Number(widthInput.value));
    return [
      "Create a photorealistic, high-quality close-up photo of the side of a woman's head, with her hair tucked back so one ear and earlobe are fully visible, wearing the earring shown in the attached product photos (the photos show the same earring).",
      "Reproduce the earring's exact design, shape, color, material and finish from the photos. Do not add or change any details.",
      `The real earring measures ${height} mm tall and ${width} mm wide. Render it at exactly that scale relative to the ear: an adult earlobe is about 20 mm tall and the whole ear about 60 mm tall.`,
      "Soft natural studio lighting, plain neutral background, no text, no watermark, no other jewelry. Show only one ear."
    ].join("\n\n");
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

  async function saveImage(index, button) {
    button.disabled = true;
    const label = button.textContent;
    button.textContent = "取得中…";
    try {
      const body = await callRelay({ action: "earringImage", url: loaded.url, index });
      const code = loaded.url.split("/").filter(Boolean).pop() || "earring";
      saveBlob(body.image, body.mime, `${code}_${index + 1}.${body.mime.includes("png") ? "png" : body.mime.includes("webp") ? "webp" : "jpg"}`);
    } catch (error) {
      setStatus(`画像を保存できませんでした: ${error.message}`, true);
    }
    button.textContent = label;
    button.disabled = false;
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
      images.replaceChildren(...info.images.map((src, index) => {
        const figure = document.createElement("figure");
        const image = document.createElement("img");
        image.src = src;
        image.alt = info.name || "商品画像";
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "画像を保存";
        button.addEventListener("click", () => saveImage(index, button));
        figure.append(image, button);
        return figure;
      }));
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
  [heightInput, widthInput].forEach((input) => input.addEventListener("input", refreshPrompt));
  copyButton.addEventListener("click", copyPrompt);
})();
