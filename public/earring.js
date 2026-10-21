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
  const hookSelect = $("earringHook");
  const copyButton = $("earringCopy");
  const modelShuffle = $("earringModelShuffle");
  const modelStatus = $("earringModelStatus");
  const modelImages = $("earringModelImages");

  let loaded = null;
  let busy = false;
  let modelPool = null;
  const MODEL_COUNT = 8;
  const MODEL_PATTERN = /ワンピース|トップス|シャツ|ブラウス|セーター|ニット|カーディガン|ジャケット|ブレザー|コート|カットソー/;

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
    let body;
    try {
      body = await response.json();
    } catch (error) {
      throw new Error("中継サーバー(Apps Script)がエラーを返しました。再デプロイが正しく反映されているか確認してください。");
    }
    if (!body.ok) throw new Error(body.error || "処理できませんでした。");
    return body;
  }

  const fmt = (value) => (Number.isFinite(value) && value > 0 ? String(Math.round(value * 10) / 10) : "?");

  function buildPrompt() {
    const height = fmt(Number(heightInput.value) / 10);
    const width = fmt(Number(widthInput.value) / 10);
    const hook = hookSelect.value === "short"
      ? "フックや留め具は短く、耳たぶの穴から本体の上端までを約0.5cmにして、商品画像のとおりの形にし、長くしない"
      : "フックや留め具、チェーンの長さと形は商品画像のとおりにして、別の形に変えたり長くしたりしない";
    return [
      "次はこの写真のピアスの着用画像を生成して。質感も忠実に。",
      `ピアスのサイズ：本体（モチーフ）は横${width}cm×縦${height}cm。${hook}（頭の奥行きを約18cm、耳全体の縦幅を6cmとして正確なサイズ感で。実際より大きく描かない）`,
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

  function fileExt(mime) {
    return mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  }

  // 画像を、中継サーバー経由で保存する
  async function saveVia(request, fileName, button, report) {
    button.disabled = true;
    const label = button.textContent;
    button.textContent = "取得中…";
    try {
      const body = await callRelay(request);
      saveBlob(body.image, body.mime, `${fileName}.${fileExt(body.mime)}`);
    } catch (error) {
      report(`画像を保存できませんでした: ${error.message}`, true);
    }
    button.textContent = label;
    button.disabled = false;
  }

  function renderImages(container, info, report) {
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
      const code = info.url.split("/").filter(Boolean).pop() || "image";
      button.addEventListener("click", () => saveVia({ action: "earringImage", url: info.url, index }, `earring_${code}_${index + 1}`, button, report));
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
      markShownAsSkipped();
      modelSeen.clear();
      shownModels = [];
      modelImages.replaceChildren();
      nameLabel.textContent = info.name || "商品";
      renderImages(images, info, setStatus);
      heightInput.value = info.heightMm ?? "";
      widthInput.value = info.widthMm ?? "";
      sizeNote.textContent = info.sizeText
        ? `商品ページの「${info.sizeLabel}」: ${info.sizeText} cm を、大きい方を縦・小さい方を横として入力しました。実際の向きと違う場合は直してください。`
        : "商品ページにモチーフのサイズが見つかりませんでした。縦と横(mm)を入力してください。";
      refreshPrompt();
      product.hidden = false;
      if (!modelImages.children.length) showModels();
      setStatus("");
    } catch (error) {
      loaded = null;
      setStatus(`読み込めませんでした: ${error.message}`, true);
    }
    loadButton.textContent = "読み込む";
    loadButton.disabled = false;
    busy = false;
  }

  // 日本サイトの商品一覧(japan-index.json)から、ワンピースやトップスなどをランダムに選ぶ
  const productSerial = (item) => Number((item.productNumber.match(/(\d+)$/) || [])[1]) || 0;

  async function loadModelPool() {
    if (modelPool) return modelPool;
    const response = await fetch(`${dataPathPrefix}japan-index.json?v=${Date.now()}`, { cache: "no-store" });
    const data = await response.json();
    // 商品番号は新しい商品ほど大きいため、降順に並べて新着から順に使う
    modelPool = (data.products || [])
      .filter((item) => MODEL_PATTERN.test(item.name || "") && /^[A-Z]{2}[A-Za-z0-9]+$/.test(item.productNumber || ""))
      .sort((x, y) => productSerial(y) - productSerial(x));
    return modelPool;
  }

  const modelImageUrl = (item, n) => `https://sc3.locondo.jp/contents/commodity_image/${item.productNumber.slice(0, 2)}/${item.productNumber}_${n}_l.jpg`;

  // 顔の検出(MediaPipe)。読み込めなければ null を返す
  let detectorPromise = null;
  function loadDetector() {
    if (!detectorPromise) {
      detectorPromise = (async () => {
        const base = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
        const { FaceDetector, FilesetResolver } = await import(`${base}/vision_bundle.mjs`);
        const fileset = await FilesetResolver.forVisionTasks(`${base}/wasm`);
        return FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite" },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.6
        });
      })().catch(() => {
        detectorPromise = null; // 失敗を覚えず、次回もう一度読み込む
        return null;
      });
    }
    return detectorPromise;
  }

  // 顔がはっきり写っている写真か判定し、点数(大きい顔・横向きほど高い)を返す。写っていなければ 0
  function faceScore(detector, bitmap) {
    const detections = detector.detect(bitmap).detections || [];
    let best = 0;
    for (const detection of detections) {
      const width = detection.boundingBox.width / bitmap.width;
      if (width < 0.22) continue;
      // 後ろ姿や服の模様を顔と誤判定した写真を除く(本物の顔は信頼度が高く、画像の上寄りに写る)
      const confidence = (detection.categories[0] && detection.categories[0].score) || 0;
      const centerY = (detection.boundingBox.originY + detection.boundingBox.height / 2) / bitmap.height;
      if (confidence < 0.85 || centerY > 0.6) continue;
      const [rightEye, leftEye, nose] = detection.keypoints;
      const eyeGap = Math.abs(leftEye.x - rightEye.x) || 1;
      const turn = Math.abs(nose.x - (leftEye.x + rightEye.x) / 2) / eyeGap;
      best = Math.max(best, width * (1 + Math.min(turn, 1)));
    }
    return best;
  }

  function dataBlob(base64, mime) {
    return new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))], { type: mime });
  }

  function modelFigure(item, found) {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = URL.createObjectURL(found.blob);
    image.alt = item.name;
    const caption = document.createElement("figcaption");
    caption.textContent = item.name.replace(/\s*\.--\s*/, " ").slice(0, 30);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "画像を保存";
    button.addEventListener("click", () => {
      saveBlob(found.base64, found.mime, `model_${item.productNumber}_${found.n}.${fileExt(found.mime)}`);
      markDownloaded(item.productNumber);
    });
    figure.append(image, caption, button);
    return figure;
  }

  let modelRun = 0;
  const modelSeen = new Set();
  let shownModels = [];
  const MODEL_BATCH = 30;
  // 保存したことのあるモデル写真は、次回以降は出さない(このブラウザに記録)
  const DOWNLOADED_KEY = "mango-earring-downloaded-models";
  const downloadedModels = () => {
    try { return new Set(JSON.parse(localStorage.getItem(DOWNLOADED_KEY) || "[]")); } catch (error) { return new Set(); }
  };
  const markDownloaded = (productNumber) => {
    const set = downloadedModels();
    set.add(productNumber);
    try { localStorage.setItem(DOWNLOADED_KEY, JSON.stringify([...set].slice(-2000))); } catch (error) { /* 保存できない場合は記録しない */ }
  };

  // 「次の写真を探す」で飛ばした写真は、ほかの候補が出尽くすまで出さない(このブラウザに記録)
  const SKIPPED_KEY = "mango-earring-skipped-models";
  const skippedModels = () => {
    try { return new Set(JSON.parse(localStorage.getItem(SKIPPED_KEY) || "[]")); } catch (error) { return new Set(); }
  };
  const markShownAsSkipped = () => {
    const downloaded = downloadedModels();
    const set = skippedModels();
    shownModels.forEach((item) => { if (!downloaded.has(item.productNumber)) set.add(item.productNumber); });
    try { localStorage.setItem(SKIPPED_KEY, JSON.stringify([...set].slice(-2000))); } catch (error) { /* 保存できない場合は記録しない */ }
  };

  const leadingDigit = (value) => (String(value || "").match(/\d/) || [""])[0];

  async function showModels() {
    const run = ++modelRun;
    modelShuffle.disabled = true;
    modelImages.replaceChildren();
    setModelStatus("新着アイテムから、顔が写っている写真を探しています…");
    try {
      const digit = leadingDigit(loaded && loaded.brandItemNumber);
      const downloaded = downloadedModels();
      const pool = (await loadModelPool()).filter((item) => (!digit || leadingDigit(item.brandItemNumber) === digit) && !downloaded.has(item.productNumber));
      if (!pool.length) throw new Error("商品データが見つかりませんでした。");
      // 未表示の候補を新着順に並べ、飛ばしたことのある写真は最後に回す
      const skipped = skippedModels();
      const order = (list) => list.filter((item) => !skipped.has(item.productNumber)).concat(list.filter((item) => skipped.has(item.productNumber)));
      let detector = await loadDetector();
      for (let attempt = 0; !detector && attempt < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        detector = await loadDetector();
      }
      // 顔を判定できないまま写真を並べると、商品だけの写真や後ろ姿が混ざるため、並べない
      if (!detector) throw new Error("顔の判定機能(インターネット上のGoogleの顔検出)を読み込めませんでした。ネットワークを確認して、もう一度「次の写真を探す」を押してください。");
      const found = [];
      let tried = 0;
      let failed = 0;
      let lastError = null;
      const render = () => {
        found.sort((x, y) => x.order - y.order);
        modelImages.replaceChildren(...found.slice(0, MODEL_COUNT).map((entry) => modelFigure(entry.item, entry)));
      };
      // 1回目の接続が不安定なことがあるため、失敗したら少し待ってもう一度取得する
      const fetchPhotos = async (item) => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await callRelay({ action: "earringPhotos", imageUrls: [2, 3, 4, 5].map((n) => modelImageUrl(item, n)) });
          } catch (error) {
            if (attempt >= 1) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
      };
      let rounds = 0;
      while (run === modelRun && !found.length && rounds < 3) {
        rounds += 1;
        let fresh = order(pool.filter((item) => !modelSeen.has(item.productNumber)));
        if (!fresh.length) {
          modelSeen.clear();
          fresh = order(pool);
        }
        const candidates = fresh.slice(0, MODEL_BATCH);
        const errored = new Set();
        let next = 0;
        const worker = async () => {
          while (run === modelRun && next < candidates.length && found.length < MODEL_COUNT) {
            const index = next;
            const item = candidates[index];
            next += 1;
            try {
              const body = await fetchPhotos(item);
              let best = null;
              for (const photo of body.photos || []) {
                const blob = dataBlob(photo.image, photo.mime);
                const bitmap = await createImageBitmap(blob);
                const score = faceScore(detector, bitmap);
                bitmap.close();
                if (score > 0 && (!best || score > best.score)) {
                  best = { order: index + (rounds - 1) * MODEL_BATCH, item, blob, base64: photo.image, mime: photo.mime, score, n: Number((photo.url.match(/_(\d+)_l\.jpg$/) || [])[1]) || 0 };
                }
              }
              if (best && run === modelRun) {
                found.push(best);
                render();
              }
            } catch (error) {
              failed += 1;
              lastError = error;
              errored.add(item.productNumber);
            }
            tried += 1;
            if (run === modelRun) setModelStatus(`顔が写っている写真を探しています… ${Math.min(found.length, MODEL_COUNT)}枚(${tried}枚を確認)`);
          }
        };
        await Promise.all(Array.from({ length: 4 }, worker));
        // 取得に失敗した商品は「確認済み」にせず、次回もう一度試す
        candidates.slice(0, next).filter((item) => !errored.has(item.productNumber)).forEach((item) => modelSeen.add(item.productNumber));
        if (!found.length && failed > 0 && failed >= tried / 2) break;
      }
      shownModels = found.slice(0, MODEL_COUNT).map((entry) => entry.item);
      if (run !== modelRun) return;
      if (!found.length && lastError && failed >= tried / 2) throw new Error(`写真を取得できませんでした(${lastError.message}) もう一度お試しください。`);
      if (!found.length) throw new Error("条件に合う写真が見つかりませんでした。もう一度お試しください。");
      setModelStatus(`${digit ? `ブランド商品番号が「${digit}」で始まる` : ""}新着アイテム順に、顔が写っている写真を並べています(耳が見えるかは写真により異なります)。使いたい写真を「画像を保存」してください。「次の写真を探す」で、さらに古いアイテムの写真を表示します。`);
    } catch (error) {
      setModelStatus(`写真を探せませんでした: ${error.message}`, true);
    }
    if (run === modelRun) modelShuffle.disabled = false;
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
  modelShuffle.addEventListener("click", () => { markShownAsSkipped(); showModels(); });
  window.addEventListener("pagehide", markShownAsSkipped);

  [heightInput, widthInput].forEach((input) => input.addEventListener("input", refreshPrompt));
  hookSelect.addEventListener("change", refreshPrompt);
  copyButton.addEventListener("click", copyPrompt);
})();
