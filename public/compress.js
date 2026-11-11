(function () {
  const root = document.getElementById("compressView");
  if (!root) return;

  const $ = (id) => document.getElementById(id);
  const fileInput = $("compressFiles");
  const dropzone = $("compressDrop");
  const formatSelect = $("compressFormat");
  const quality = $("compressQuality");
  const qualityValue = $("compressQualityValue");
  const presetSelect = $("compressPreset");
  const targetInput = $("compressTarget");
  const maxSideInput = $("compressMaxSide");
  const grid = $("compressGrid");
  const emptyNote = $("compressEmpty");
  const summary = $("compressSummary");
  const allButton = $("compressAll");
  const clearButton = $("compressClear");

  const TYPES = {
    jpeg: { mime: "image/jpeg", ext: "jpg" },
    png: { mime: "image/png", ext: "png" },
    webp: { mime: "image/webp", ext: "webp" }
  };

  let items = [];
  let runId = 0;
  let timer = 0;

  const formatBytes = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const baseName = (file) => file.name.replace(/\.[^.]*$/, "");

  function outputType(file) {
    if (formatSelect.value !== "original") return TYPES[formatSelect.value];
    return Object.values(TYPES).find((type) => type.mime === file.type) || TYPES.jpeg;
  }

  const canvasBlob = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type.mime, type.mime === "image/png" ? undefined : q));

  function drawScaled(bitmap, scale, type) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    if (type.mime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // 画質を下げながら、目標サイズに入る一番高い画質を探す(二分探索)
  async function encodeWithin(canvas, type, maxQuality, targetBytes) {
    const top = await canvasBlob(canvas, type, maxQuality);
    if (!top || !targetBytes || type.mime === "image/png" || top.size <= targetBytes) return top;
    let low = 0.1;
    let high = maxQuality;
    let best = null;
    for (let step = 0; step < 10; step += 1) {
      const mid = (low + high) / 2;
      const blob = await canvasBlob(canvas, type, mid);
      if (blob && blob.size <= targetBytes) { best = blob; low = mid; } else { high = mid; }
    }
    return best;
  }

  async function compressItem(item) {
    const type = outputType(item.file);
    const targetBytes = Number(targetInput.value) > 0 ? Number(targetInput.value) * 1024 : 0;
    // 目標サイズ(投稿先の上限を含む)があるときは、画質のスライダーを使わず、上限に収まる一番高い画質まで上げる
    const q = targetBytes ? 1 : Number(quality.value) / 100;
    const maxSide = Number(maxSideInput.value) > 0 ? Number(maxSideInput.value) : 0;
    // 投稿先の上限を選んでいるときは、すでに上限以内の画像を劣化させず、そのまま使う
    if (presetSelect.value && targetBytes && !maxSide && item.file.size <= targetBytes) {
      return { blob: item.file, width: item.bitmap.width, height: item.bitmap.height, name: item.file.name, kept: true, reason: "上限以内のため、元のままです" };
    }
    const longSide = Math.max(item.bitmap.width, item.bitmap.height);
    let scale = maxSide && longSide > maxSide ? maxSide / longSide : 1;

    let canvas = drawScaled(item.bitmap, scale, type);
    let blob = await encodeWithin(canvas, type, q, targetBytes);
    // 画質を下げても目標に入らないときは、少しずつ小さくする
    while (targetBytes && (!blob || blob.size > targetBytes) && canvas.width > 400 && scale > 0.1) {
      scale *= 0.85;
      canvas = drawScaled(item.bitmap, scale, type);
      blob = await encodeWithin(canvas, type, q, targetBytes);
    }
    if (!blob) throw new Error("encode failed");
    const reduced = scale < 1;
    // 軽くならなかったときは、元のファイルをそのまま使う
    if (!reduced && blob.size >= item.file.size) {
      return { blob: item.file, width: item.bitmap.width, height: item.bitmap.height, name: item.file.name, kept: true };
    }
    return { blob, width: canvas.width, height: canvas.height, name: `${baseName(item.file)}_light.${type.ext}`, kept: false };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render() {
    grid.replaceChildren();
    emptyNote.hidden = items.length > 0;
    allButton.disabled = !items.some((item) => item.result);
    clearButton.disabled = !items.length;
    const done = items.filter((item) => item.result);
    const before = done.reduce((sum, item) => sum + item.file.size, 0);
    const after = done.reduce((sum, item) => sum + item.result.blob.size, 0);
    summary.textContent = done.length && before
      ? `${items.length}件 / 合計 ${formatBytes(before)} → ${formatBytes(after)}(${Math.round((1 - after / before) * 100)}%軽く)`
      : (items.length ? `${items.length}件` : "");
    for (const item of items) {
      const card = el("article", "resize-card");
      const preview = el("div", "resize-preview");
      if (item.url) {
        const image = document.createElement("img");
        image.src = item.url;
        image.alt = item.file.name;
        preview.appendChild(image);
      }
      card.appendChild(preview);
      card.appendChild(el("p", "resize-name", item.file.name));
      if (item.error) {
        card.appendChild(el("p", "resize-meta is-error", item.error));
      } else if (item.result) {
        const cut = Math.round((1 - item.result.blob.size / item.file.size) * 100);
        card.appendChild(el("p", "resize-meta", `${item.bitmap.width}×${item.bitmap.height} (${formatBytes(item.file.size)})`));
        card.appendChild(el("p", "resize-meta is-after", item.result.kept
          ? `→ ${item.result.reason || "これ以上軽くなりませんでした(元のまま)"}`
          : `→ ${item.result.width}×${item.result.height} (${formatBytes(item.result.blob.size)} / ${cut}%軽く)`));
        const link = el("a", "resize-download", "ダウンロード");
        link.href = item.url;
        link.download = item.result.name;
        if (!item.result.kept) link.href = item.resultUrl;
        card.appendChild(link);
      } else {
        card.appendChild(el("p", "resize-meta", "処理中…"));
      }
      grid.appendChild(card);
    }
  }

  async function processAll() {
    const current = ++runId;
    for (const item of items) {
      if (current !== runId) return;
      if (item.error) continue;
      try {
        item.result = await compressItem(item);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        item.resultUrl = URL.createObjectURL(item.result.blob);
      } catch (error) {
        item.result = null;
        item.error = "軽くできませんでした";
      }
    }
    if (current === runId) render();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { items.forEach((item) => { if (!item.error) item.result = null; }); render(); processAll(); }, 300);
  }

  function clearItems() {
    runId += 1;
    items.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      if (item.bitmap) item.bitmap.close();
    });
    items = [];
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter((file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name));
    if (!files.length) return;
    clearItems();
    for (const file of files) {
      const item = { file, bitmap: null, result: null, url: URL.createObjectURL(file), resultUrl: "", error: "" };
      try {
        item.bitmap = await createImageBitmap(file);
      } catch (error) {
        item.error = "この画像は読み込めませんでした";
      }
      items.push(item);
    }
    render();
    processAll();
  }

  function download(blob, name) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  function uniqueNames(entries) {
    const used = new Set();
    return entries.map((entry) => {
      let name = entry.name;
      for (let n = 2; used.has(name); n += 1) name = entry.name.replace(/(\.[^.]*)$/, `_${n}$1`);
      used.add(name);
      return { ...entry, name };
    });
  }

  allButton.addEventListener("click", async () => {
    const entries = uniqueNames(items.filter((item) => item.result).map((item) => ({ name: item.result.name, blob: item.result.blob })));
    if (!entries.length) return;
    allButton.disabled = true;
    for (let i = 0; i < entries.length; i += 1) {
      if (i) await new Promise((resolve) => setTimeout(resolve, 400));
      download(entries[i].blob, entries[i].name);
    }
    allButton.disabled = false;
  });

  clearButton.addEventListener("click", () => {
    clearItems();
    fileInput.value = "";
    render();
  });

  fileInput.addEventListener("change", () => addFiles(fileInput.files));
  ["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-over");
  }));
  ["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-over");
  }));
  dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));

  quality.addEventListener("input", () => { qualityValue.textContent = quality.value; schedule(); });
presetSelect.addEventListener("change", () => {
    if (presetSelect.value) targetInput.value = presetSelect.value;
    schedule();
  });
  // 目標サイズを自分で書き換えたら、投稿先の選択は外す
  targetInput.addEventListener("input", () => { if (presetSelect.value && targetInput.value !== presetSelect.value) presetSelect.value = ""; });
  [formatSelect, targetInput, maxSideInput].forEach((control) => control.addEventListener("input", schedule));

  render();
})();
