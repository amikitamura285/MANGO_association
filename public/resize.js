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
  const quality = $("resizeQuality");
  const qualityValue = $("resizeQualityValue");
  const grid = $("resizeGrid");
  const emptyNote = $("resizeEmpty");
  const summary = $("resizeSummary");
  const allButton = $("resizeAll");
  const clearButton = $("resizeClear");
  const snsButtons = [...root.querySelectorAll("[data-preset]")];
  const editor = $("resizeEditor");
  const editorTitle = $("resizeEditorTitle");
  const editorCanvas = $("resizeEditorCanvas");
  const editorThumbs = $("resizeEditorThumbs");
  const editorZoom = $("resizeEditorZoom");
  const editorDownload = $("resizeEditorDownload");
  const editorAll = $("resizeEditorAll");
  const editorReset = $("resizeEditorReset");
  const editorClose = $("resizeEditorClose");
  const editorStatus = $("resizeEditorStatus");
  const editorNote = $("resizeEditorNote");
  const presetNote = editorNote.textContent;
  const FREE_NOTE = "ドラッグで位置、スライダーまたはホイールで拡大を調整できます。この枠のとおりに切り抜かれます。";

  const MODES = {
    width: { label: "幅 (px)", unit: 800 },
    height: { label: "高さ (px)", unit: 800 },
    long: { label: "長辺 (px)", unit: 1000 },
    percent: { label: "倍率 (%)", unit: 50 },
    exact: { label: "幅 (px)", unit: 800, crop: true },
    ratio54: { label: "幅 (px)", unit: 1080, crop: true },
    magTitle: { fixed: [350, 1000], crop: true },
    magCarousel: { fixed: [640, 960], crop: true }
  };
  const PRESETS = {
    igFeed: { label: "Instagram フィード投稿 縦長 4:3", width: 1080, height: 1440 },
    igStory: { label: "Instagram ストーリーズ", width: 1080, height: 1920 },
    xSquare: { label: "X 正方形 1:1", width: 1080, height: 1080 }
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
  let editing = null;
  let dragging = null;
  let previewWidth = 1;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const formatBytes = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  function targetSize(width, height) {
    const a = Number(valueA.value) || 0;
    const b = Number(valueB.value) || 0;
    let w;
    let h;
    const fixed = MODES[modeSelect.value].fixed;
    if (fixed) return fixed;
    switch (modeSelect.value) {
      case "width": w = a; h = height * (a / width); break;
      case "height": h = a; w = width * (a / height); break;
      case "long": { const scale = a / Math.max(width, height); w = width * scale; h = height * scale; break; }
      case "percent": w = width * a / 100; h = height * a / 100; break;
      case "ratio54": w = a; h = a * 4 / 5; break;
      default: w = a; h = b;
    }
    return [Math.min(MAX_SIDE, Math.max(1, Math.round(w))), Math.min(MAX_SIDE, Math.max(1, Math.round(h)))];
  }

  function outputType(file) {
    if (formatSelect.value !== "original") return TYPES[formatSelect.value];
    return Object.values(TYPES).find((type) => type.mime === file.type) || TYPES.png;
  }

  const baseName = (file) => file.name.replace(/\.[^.]*$/, "");

  function canvasBlob(canvas, type) {
    const q = type.mime === "image/png" ? undefined : Number(quality.value) / 100;
    return new Promise((resolve) => canvas.toBlob(resolve, type.mime, q));
  }

  // 元画像の (sx, sy, sw, sh) の範囲を width×height に描いたものを返す
  async function renderBlob(item, width, height, sx, sy, sw, sh) {
    const type = outputType(item.file);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    if (type.mime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(item.bitmap, sx, sy, sw, sh, 0, 0, width, height);
    const blob = await canvasBlob(canvas, type);
    return blob ? { blob, type } : null;
  }

  async function resizeItem(item) {
    if (!item.bitmap) return;
    const [width, height] = targetSize(item.bitmap.width, item.bitmap.height);
    const region = MODES[modeSelect.value].crop || item.crops.free ? cropRegion(item, "free") : null;
    const output = region
      ? await renderBlob(item, width, height, region.sx, region.sy, region.vw, region.vh)
      : await renderBlob(item, width, height, 0, 0, item.bitmap.width, item.bitmap.height);
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
    allButton.disabled = !items.some((item) => item.result);
    clearButton.disabled = !items.length;
    const usable = items.some((item) => item.bitmap);
    snsButtons.forEach((button) => { button.disabled = !usable; });
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
        const adjust = el("button", "resize-adjust", "位置を調整");
        adjust.type = "button";
        adjust.addEventListener("click", () => openEditor("free", editorItems().indexOf(item)));
        card.appendChild(adjust);
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

  function clearItems() {
    runId += 1;
    items.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.sourceUrl) URL.revokeObjectURL(item.sourceUrl);
      if (item.bitmap) item.bitmap.close();
    });
    items = [];
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter((file) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name));
    if (!files.length) return;
    clearItems();
    for (const file of files) {
      const item = { file, bitmap: null, result: null, url: "", error: "", crops: {}, box: undefined, sourceUrl: "" };
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
    valueA.parentElement.hidden = Boolean(mode.fixed);
    if (mode.fixed) { wrapB.hidden = true; return; }
    labelA.textContent = mode.label;
    valueA.value = mode.unit;
    wrapB.hidden = modeSelect.value !== "exact";
  }

  // ---- SNS用: 余白なしで切り抜き(位置とズームを調整できる) ----
  // 背景(白・透明・単色)の余白を除いた、被写体の範囲を元画像の座標で返す。判定できなければ null
  function detectContent(bitmap) {
    const scale = Math.min(1, 300 / Math.max(bitmap.width, bitmap.height));
    const cw = Math.max(1, Math.round(bitmap.width * scale));
    const ch = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, cw, ch);
    const data = context.getImageData(0, 0, cw, ch).data;
    const at = (x, y) => (y * cw + x) * 4;
    const corners = [at(0, 0), at(cw - 1, 0), at(0, ch - 1), at(cw - 1, ch - 1)].map((i) => [data[i], data[i + 1], data[i + 2], data[i + 3]]);
    const transparent = corners.reduce((sum, c) => sum + c[3], 0) / 4 < 128;
    const median = (channel) => corners.map((c) => c[channel]).sort((a, b) => a - b)[1];
    const bg = [median(0), median(1), median(2)];
    if (!transparent) {
      const spread = Math.max(...[0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k])) - Math.min(...corners.map((c) => c[k]))));
      if (spread > 40) return null;
    }
    const rows = new Array(ch).fill(0);
    const cols = new Array(cw).fill(0);
    for (let y = 0; y < ch; y += 1) {
      for (let x = 0; x < cw; x += 1) {
        const i = at(x, y);
        const isContent = transparent
          ? data[i + 3] > 32
          : data[i + 3] > 32 && Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2])) > 30;
        if (isContent) { rows[y] += 1; cols[x] += 1; }
      }
    }
    const first = (counts, need) => counts.findIndex((n) => n >= need);
    const last = (counts, need) => counts.length - 1 - [...counts].reverse().findIndex((n) => n >= need);
    const top = first(rows, Math.max(1, cw * 0.005));
    const left = first(cols, Math.max(1, ch * 0.005));
    if (top < 0 || left < 0) return null;
    const bottom = last(rows, Math.max(1, cw * 0.005));
    const right = last(cols, Math.max(1, ch * 0.005));
    const box = {
      x: left / scale,
      y: top / scale,
      w: (right - left + 1) / scale,
      h: (bottom - top + 1) / scale
    };
    if (box.w < bitmap.width * 0.08 || box.h < bitmap.height * 0.08) return null;
    if (box.w > bitmap.width * 0.97 && box.h > bitmap.height * 0.97) return null;
    return box;
  }

  function sizeFor(item, key) {
    if (key !== "free") return PRESETS[key];
    const [width, height] = targetSize(item.bitmap.width, item.bitmap.height);
    return { label: "フリーサイズ", width, height };
  }

  function cropFor(item, key) {
    if (!item.crops[key]) {
      const preset = sizeFor(item, key);
      const crop = { zoom: 1, x: item.bitmap.width / 2, y: item.bitmap.height / 2 };
      if (key !== "free" && item.box === undefined) item.box = detectContent(item.bitmap);
      if (key !== "free" && item.box) {
        const regionWidth = Math.min(item.box.w, (item.box.h * preset.width) / preset.height);
        const cover = Math.max(preset.width / item.bitmap.width, preset.height / item.bitmap.height);
        crop.zoom = clamp(preset.width / regionWidth / cover, 1, 5);
        crop.x = item.box.x + item.box.w / 2;
        crop.y = item.box.y + item.box.h / 2;
      }
      item.crops[key] = crop;
    }
    return item.crops[key];
  }

  function cropRegion(item, key) {
    const preset = sizeFor(item, key);
    const crop = cropFor(item, key);
    const scale = Math.max(preset.width / item.bitmap.width, preset.height / item.bitmap.height) * crop.zoom;
    const vw = preset.width / scale;
    const vh = preset.height / scale;
    crop.x = clamp(crop.x, vw / 2, Math.max(vw / 2, item.bitmap.width - vw / 2));
    crop.y = clamp(crop.y, vh / 2, Math.max(vh / 2, item.bitmap.height - vh / 2));
    return { sx: crop.x - vw / 2, sy: crop.y - vh / 2, vw, vh };
  }

  async function cropToBlob(item, key) {
    const preset = sizeFor(item, key);
    const region = cropRegion(item, key);
    const output = await renderBlob(item, preset.width, preset.height, region.sx, region.sy, region.vw, region.vh);
    const name = key === "free" ? `${baseName(item.file)}_resized.${output?.type.ext}` : `${baseName(item.file)}_${key}_${preset.width}x${preset.height}.${output?.type.ext}`;
    return output ? { name, blob: output.blob } : null;
  }

  const editorItems = () => items.filter((item) => item.bitmap);
  const editorItem = () => editorItems()[editing.index];

  function drawEditor() {
    const item = editorItem();
    const preset = sizeFor(item, editing.key);
    const ratio = Math.min(Math.min(480, window.innerWidth * 0.8) / preset.width, Math.min(window.innerHeight * 0.5, 520) / preset.height);
    previewWidth = Math.round(preset.width * ratio);
    const previewHeight = Math.round(preset.height * ratio);
    editorCanvas.style.width = `${previewWidth}px`;
    editorCanvas.style.height = `${previewHeight}px`;
    editorCanvas.width = previewWidth * 2;
    editorCanvas.height = previewHeight * 2;
    const region = cropRegion(item, editing.key);
    const context = editorCanvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(item.bitmap, region.sx, region.sy, region.vw, region.vh, 0, 0, editorCanvas.width, editorCanvas.height);
    editorZoom.value = Math.round(cropFor(item, editing.key).zoom * 100);
    editorTitle.textContent = `${preset.label}  ${preset.width}×${preset.height}`;
    editorThumbs.querySelectorAll("button").forEach((button, index) => button.classList.toggle("is-active", index === editing.index));
  }

  function openEditor(key, startIndex = 0) {
    const list = editorItems();
    if (!list.length) return;
    editing = { key, index: Math.max(0, startIndex) };
    editorNote.textContent = key === "free" ? FREE_NOTE : presetNote;
    editorThumbs.replaceChildren();
    list.forEach((item, index) => {
      if (!item.sourceUrl) item.sourceUrl = URL.createObjectURL(item.file);
      const button = el("button", "");
      button.type = "button";
      const image = document.createElement("img");
      image.src = item.sourceUrl;
      image.alt = item.file.name;
      button.appendChild(image);
      button.addEventListener("click", () => { editing.index = index; editorStatus.textContent = ""; drawEditor(); });
      editorThumbs.appendChild(button);
    });
    editorThumbs.hidden = list.length < 2;
    editorAll.hidden = list.length < 2;
    editorStatus.textContent = "";
    editor.hidden = false;
    drawEditor();
  }

  function closeEditor() {
    const wasFree = editing && editing.key === "free";
    editor.hidden = true;
    editing = null;
    dragging = null;
    if (wasFree) processAll();
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

  async function downloadEach(entries) {
    for (let i = 0; i < entries.length; i += 1) {
      if (i) await new Promise((resolve) => setTimeout(resolve, 400));
      download(entries[i].blob, entries[i].name);
    }
  }

  allButton.addEventListener("click", async () => {
    const entries = uniqueNames(items.filter((item) => item.result).map((item) => ({ name: item.result.name, blob: item.result.blob })));
    if (!entries.length) return;
    allButton.disabled = true;
    await downloadEach(entries);
    allButton.disabled = false;
  });

  // ---- イベント ----
  snsButtons.forEach((button) => button.addEventListener("click", () => openEditor(button.dataset.preset)));

  editorDownload.addEventListener("click", async () => {
    const output = await cropToBlob(editorItem(), editing.key);
    if (output) download(output.blob, output.name);
    editorStatus.textContent = output ? `${output.name} をダウンロードしました。` : "作成できませんでした。";
  });

  editorAll.addEventListener("click", async () => {
    const key = editing.key;
    editorAll.disabled = true;
    const entries = [];
    for (const item of editorItems()) {
      const output = await cropToBlob(item, key);
      if (output) entries.push(output);
    }
    await downloadEach(uniqueNames(entries));
    editorStatus.textContent = `${entries.length}件をダウンロードしました。`;
    editorAll.disabled = false;
  });

  editorReset.addEventListener("click", () => {
    delete editorItem().crops[editing.key];
    drawEditor();
  });
  editorClose.addEventListener("click", closeEditor);
  editor.addEventListener("click", (event) => { if (event.target === editor) closeEditor(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && editing) closeEditor(); });

  editorZoom.addEventListener("input", () => {
    cropFor(editorItem(), editing.key).zoom = Number(editorZoom.value) / 100;
    drawEditor();
  });
  editorCanvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const crop = cropFor(editorItem(), editing.key);
    crop.zoom = clamp(crop.zoom * Math.exp(-event.deltaY * 0.001), 1, 5);
    drawEditor();
  }, { passive: false });
  editorCanvas.addEventListener("pointerdown", (event) => {
    dragging = { x: event.clientX, y: event.clientY };
    editorCanvas.setPointerCapture(event.pointerId);
  });
  editorCanvas.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const item = editorItem();
    const crop = cropFor(item, editing.key);
    const perPixel = cropRegion(item, editing.key).vw / previewWidth;
    crop.x -= (event.clientX - dragging.x) * perPixel;
    crop.y -= (event.clientY - dragging.y) * perPixel;
    dragging = { x: event.clientX, y: event.clientY };
    drawEditor();
  });
  ["pointerup", "pointercancel"].forEach((name) => editorCanvas.addEventListener(name, () => { dragging = null; }));

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

  modeSelect.addEventListener("change", () => { applyMode(); schedule(); });
  [valueA, valueB, formatSelect].forEach((control) => control.addEventListener("input", schedule));
  quality.addEventListener("input", () => { qualityValue.textContent = quality.value; schedule(); });

  applyMode();
  render();
})();
