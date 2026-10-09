(function () {
  const root = document.getElementById("resizeView");
  if (!root) return;

  const $ = (id) => document.getElementById(id);
  const fileInput = $("resizeFiles");
  const dropzone = $("resizeDrop");
  const modeSelect = $("resizeMode");
  const valueA = $("resizeValueA");
  const valueB = $("resizeValueB");
  const labelA = $("resizeLabelA");
  const wrapB = $("resizeWrapB");
  const formatSelect = $("resizeFormat");
  const fitSelect = $("resizeFit");
  const bgInput = $("resizeBg");
  const wrapBg = $("resizeWrapBg");
  const quality = $("resizeQuality");
  const qualityValue = $("resizeQualityValue");
  const grid = $("resizeGrid");
  const emptyNote = $("resizeEmpty");
  const summary = $("resizeSummary");
  const zipButton = $("resizeZip");
  const clearButton = $("resizeClear");
  const snsButtons = [...root.querySelectorAll("[data-preset]")];
  const snsStatus = $("resizeSnsStatus");

  const MODES = {
    width: { label: "幅 (px)", unit: 800 },
    height: { label: "高さ (px)", unit: 800 },
    long: { label: "長辺 (px)", unit: 1000 },
    percent: { label: "倍率 (%)", unit: 50 },
    exact: { label: "幅 (px)", unit: 800 }
  };
  const PRESETS = {
    igFeed: { label: "IGフィード", width: 1440, height: 1080 },
    igStory: { label: "ストーリーズ", width: 1080, height: 1920 },
    xSquare: { label: "X正方形", width: 1080, height: 1080 }
  };
  const TYPES = {
    jpeg: { mime: "image/jpeg", ext: "jpg" },
    png: { mime: "image/png", ext: "png" },
    webp: { mime: "image/webp", ext: "webp" }
  };
  const MAX_SIDE = 16384;

  let items = [];
  let runId = 0;
  let timer = 0;

  const formatBytes = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  function targetSize(width, height) {
    const a = Number(valueA.value) || 0;
    const b = Number(valueB.value) || 0;
    let w;
    let h;
    switch (modeSelect.value) {
      case "width": w = a; h = height * (a / width); break;
      case "height": h = a; w = width * (a / height); break;
      case "long": { const scale = a / Math.max(width, height); w = width * scale; h = height * scale; break; }
      case "percent": w = width * a / 100; h = height * a / 100; break;
      default: w = a; h = b;
    }
    return [Math.min(MAX_SIDE, Math.max(1, Math.round(w))), Math.min(MAX_SIDE, Math.max(1, Math.round(h)))];
  }

  function outputType(file) {
    if (formatSelect.value !== "original") return TYPES[formatSelect.value];
    return Object.values(TYPES).find((type) => type.mime === file.type) || TYPES.png;
  }

  function baseName(file) {
    return file.name.replace(/\.[^.]*$/, "");
  }

  function canvasBlob(canvas, type) {
    const q = type.mime === "image/png" ? undefined : Number(quality.value) / 100;
    return new Promise((resolve) => canvas.toBlob(resolve, type.mime, q));
  }

  // fit: "stretch"(指定サイズに合わせる) / "pad"(余白を足して収める) / "cover"(切り抜く)
  async function drawToBlob(item, width, height, fit) {
    const type = outputType(item.file);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    const { bitmap } = item;
    if (fit === "stretch") {
      if (type.mime === "image/jpeg") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
      }
      context.drawImage(bitmap, 0, 0, width, height);
    } else {
      const scale = (fit === "cover" ? Math.max : Math.min)(width / bitmap.width, height / bitmap.height);
      const drawWidth = bitmap.width * scale;
      const drawHeight = bitmap.height * scale;
      context.fillStyle = bgInput.value;
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    }
    const blob = await canvasBlob(canvas, type);
    return blob ? { blob, type } : null;
  }

  async function resizeItem(item) {
    if (!item.bitmap) return;
    const [width, height] = targetSize(item.bitmap.width, item.bitmap.height);
    const output = await drawToBlob(item, width, height, "stretch");
    if (item.url) URL.revokeObjectURL(item.url);
    item.result = output ? { blob: output.blob, width, height, name: `${baseName(item.file)}_resized.${output.type.ext}` } : null;
    item.url = output ? URL.createObjectURL(output.blob) : "";
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
    zipButton.disabled = !items.some((item) => item.result);
    clearButton.disabled = !items.length;
    const usable = items.some((item) => item.bitmap);
    snsButtons.forEach((button) => { button.disabled = !usable || button.dataset.busy === "1"; });
    const done = items.filter((item) => item.result);
    summary.textContent = items.length
      ? `${items.length}件 / 変換後の合計 ${formatBytes(done.reduce((sum, item) => sum + item.result.blob.size, 0))}`
      : "";
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
        card.appendChild(el("p", "resize-meta", `${item.bitmap.width}×${item.bitmap.height} (${formatBytes(item.file.size)})`));
        card.appendChild(el("p", "resize-meta is-after", `→ ${item.result.width}×${item.result.height} (${formatBytes(item.result.blob.size)})`));
        const link = el("a", "resize-download", "ダウンロード");
        link.href = item.url;
        link.download = item.result.name;
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
        await resizeItem(item);
      } catch (error) {
        item.error = "変換できませんでした";
      }
    }
    if (current === runId) render();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { render(); processAll(); }, 250);
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter((file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name));
    for (const file of files) {
      const item = { file, bitmap: null, result: null, url: "", error: "" };
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

  function applyMode() {
    const mode = MODES[modeSelect.value];
    labelA.textContent = mode.label;
    valueA.value = mode.unit;
    wrapB.hidden = modeSelect.value !== "exact";
  }

  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  async function buildZip(entries) {
    const encoder = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const entry of entries) {
      const data = new Uint8Array(await entry.blob.arrayBuffer());
      const name = encoder.encode(entry.name);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(local.buffer, name, data);
      const header = new DataView(new ArrayBuffer(46));
      header.setUint32(0, 0x02014b50, true);
      header.setUint16(4, 20, true);
      header.setUint16(6, 20, true);
      header.setUint16(8, 0x0800, true);
      header.setUint16(12, dosTime, true);
      header.setUint16(14, dosDate, true);
      header.setUint32(16, crc, true);
      header.setUint32(20, data.length, true);
      header.setUint32(24, data.length, true);
      header.setUint16(28, name.length, true);
      header.setUint32(42, offset, true);
      central.push(header.buffer, name);
      offset += 30 + name.length + data.length;
    }
    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
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

  zipButton.addEventListener("click", async () => {
    const entries = uniqueNames(items.filter((item) => item.result).map((item) => ({ name: item.result.name, blob: item.result.blob })));
    if (!entries.length) return;
    zipButton.disabled = true;
    download(await buildZip(entries), "resized-images.zip");
    zipButton.disabled = false;
  });

  snsButtons.forEach((button) => button.addEventListener("click", async () => {
    const key = button.dataset.preset;
    const preset = PRESETS[key];
    const targets = items.filter((item) => item.bitmap);
    if (!targets.length) return;
    button.dataset.busy = "1";
    button.disabled = true;
    snsStatus.textContent = `${preset.label} を作成中…`;
    try {
      const entries = [];
      for (const item of targets) {
        const output = await drawToBlob(item, preset.width, preset.height, fitSelect.value);
        if (output) entries.push({ name: `${baseName(item.file)}_${key}_${preset.width}x${preset.height}.${output.type.ext}`, blob: output.blob });
      }
      const named = uniqueNames(entries);
      if (named.length === 1) download(named[0].blob, named[0].name);
      else if (named.length > 1) download(await buildZip(named), `${key}_${preset.width}x${preset.height}.zip`);
      snsStatus.textContent = named.length
        ? `${preset.label} ${preset.width}×${preset.height} を${named.length}件ダウンロードしました${named.length > 1 ? "(ZIP)" : ""}。`
        : "作成できませんでした。";
    } catch (error) {
      snsStatus.textContent = "作成できませんでした。";
    }
    button.dataset.busy = "";
    render();
  }));

  clearButton.addEventListener("click", () => {
    runId += 1;
    items.forEach((item) => { if (item.url) URL.revokeObjectURL(item.url); if (item.bitmap) item.bitmap.close(); });
    items = [];
    fileInput.value = "";
    snsStatus.textContent = "";
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

  modeSelect.addEventListener("change", () => { applyMode(); schedule(); });
  fitSelect.addEventListener("change", () => { wrapBg.hidden = fitSelect.value === "cover"; });
  [valueA, valueB, formatSelect].forEach((control) => control.addEventListener("input", schedule));
  quality.addEventListener("input", () => { qualityValue.textContent = quality.value; schedule(); });

  applyMode();
  render();
})();
