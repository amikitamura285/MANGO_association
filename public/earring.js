(function () {
  const root = document.getElementById("earringView");
  if (!root) return;

  const $ = (id) => document.getElementById(id);
  const fileInput = $("earringFile");
  const dropzone = $("earringDrop");
  const heightInput = $("earringHeight");
  const widthInput = $("earringWidth");
  const generate = $("earringGenerate");
  const status = $("earringStatus");
  const source = $("earringSource");
  const result = $("earringResult");
  const resultImage = $("earringResultImage");
  const download = $("earringDownload");
  const MAX_SIDE = 1024;

  let imageData = null;
  let baseName = "earring";
  let busy = false;

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  };

  const refresh = () => {
    generate.disabled = busy || !imageData;
  };

  async function loadImage(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("画像ファイルを選んでください。", true);
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      imageData = dataUrl.split(",")[1];
      baseName = file.name.replace(/\.[^.]*$/, "") || "earring";
      source.src = dataUrl;
      source.hidden = false;
      result.hidden = true;
      setStatus("");
    } catch (error) {
      imageData = null;
      source.hidden = true;
      setStatus("この画像は読み込めませんでした。", true);
    }
    refresh();
  }

  function readSize(input, label) {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 1 || value > 200) throw new Error(`${label}は1〜200mmで入力してください。`);
    return Math.round(value * 10) / 10;
  }

  generate.addEventListener("click", async () => {
    if (busy || !imageData) return;
    let heightMm;
    let widthMm;
    try {
      heightMm = readSize(heightInput, "縦");
      widthMm = readSize(widthInput, "横");
    } catch (error) {
      setStatus(error.message, true);
      return;
    }
    busy = true;
    generate.textContent = "生成中…";
    refresh();
    result.hidden = true;
    setStatus("生成しています。20〜40秒ほどかかります。");
    try {
      const response = await fetch(GLOBAL_RELAY_URL, {
        method: "POST",
        headers: { "content-type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "earring", image: imageData, mime: "image/jpeg", heightMm, widthMm })
      });
      const body = await response.json();
      if (!body.ok) throw new Error(body.error || "生成できませんでした。");
      resultImage.src = `data:${body.mime || "image/png"};base64,${body.image}`;
      download.href = resultImage.src;
      download.download = `${baseName}_worn.${(body.mime || "image/png").includes("jpeg") ? "jpg" : "png"}`;
      result.hidden = false;
      setStatus(body.remaining === undefined ? "生成しました。" : `生成しました。本日の残り回数: ${body.remaining}回`);
    } catch (error) {
      setStatus(`生成に失敗しました: ${error.message}`, true);
    }
    busy = false;
    generate.textContent = "着用画像を生成";
    refresh();
  });

  fileInput.addEventListener("change", () => loadImage(fileInput.files[0]));
  ["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-over");
  }));
  ["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-over");
  }));
  dropzone.addEventListener("drop", (event) => loadImage(event.dataTransfer.files[0]));
  refresh();
})();
