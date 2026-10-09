# Daily global collection on this PC.
# Opens a visible Chrome (dedicated profile), runs the same collector as the bookmarklet on shop.mango.com,
# then sends the result to the Apps Script relay (which commits data/global-raw.json).
# Messages are ASCII on purpose (Windows PowerShell 5.1 misreads BOM-less UTF-8).
param(
  [switch]$DryRun,   # collect only; save raw JSON next to the log and do not publish
  [switch]$Force     # run even if a run already succeeded today
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$SiteBase = "https://amikitamura285.github.io/MANGO_association/"
$RelayUrl = "https://script.google.com/macros/s/AKfycbxqxYvg2SIIEoEsvY4I0Ehly-eD_B3Thmu5PQvstHRFerVDgUOlievb-AsPgjDjlrCuxQ/exec"
$StartUrl = "https://shop.mango.com/gb/en/search/women"
$Port = 9223
$MaxMinutes = 45

$Dir = Join-Path $env:LOCALAPPDATA "mango-finder"
$LogFile = Join-Path $Dir "auto-global.log"
$OkFile = Join-Path $Dir "last-success.txt"
$ChromeProfile = Join-Path $Dir "chrome-profile"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

function Log($text) {
  $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $text
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  Write-Host $line
}

# ---- minimal CDP client ----
$script:ws = $null
$script:msgId = 0

function Receive-Message([int]$timeoutMs) {
  $buffer = New-Object byte[] 1048576
  $stream = New-Object System.IO.MemoryStream
  $cts = New-Object System.Threading.CancellationTokenSource($timeoutMs)
  do {
    $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
    $result = $script:ws.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()
    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw "Chrome closed the connection" }
    $stream.Write($buffer, 0, $result.Count)
  } until ($result.EndOfMessage)
  return [System.Text.Encoding]::UTF8.GetString($stream.ToArray())
}

function Invoke-Cdp([string]$method, $params = @{}, [int]$timeoutMs = 60000) {
  $script:msgId += 1
  $id = $script:msgId
  $json = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 20 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
  $script:ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  while ($true) {
    $message = Receive-Message $timeoutMs | ConvertFrom-Json
    if ($message.id -eq $id) {
      if ($message.error) { throw "CDP $method failed: $($message.error.message)" }
      return $message.result
    }
  }
}

function Eval-Js([string]$expression, [int]$timeoutMs = 60000) {
  $result = Invoke-Cdp "Runtime.evaluate" @{ expression = $expression; returnByValue = $true; awaitPromise = $true } $timeoutMs
  if ($result.exceptionDetails) { throw "JS error: $($result.exceptionDetails.exception.description)" }
  return $result.result.value
}

function Find-Chrome {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  foreach ($path in $candidates) { if ($path -and (Test-Path $path)) { return $path } }
  throw "Chrome was not found"
}

function Download-Text([string]$url) {
  $client = New-Object System.Net.WebClient
  $client.Encoding = [System.Text.Encoding]::UTF8
  try { return $client.DownloadString($url) } finally { $client.Dispose() }
}

# Stand-in for the finder page: answers the collector's context request and captures its output.
$StubJs = @'
(() => {
  const ORIGIN = "https://amikitamura285.github.io";
  const state = { raw: null, error: "", progress: "", steps: 0 };
  window.__auto = state;
  function buildContext() {
    const src = window.__ctxSrc || {};
    const previous = src.previous || null;
    const japan = (src.japan && src.japan.products) || [];
    const knownCandidates = {};
    for (const entry of (previous && previous.matches) || []) {
      for (const candidate of entry.relatedGlobal || []) knownCandidates[candidate.productNumber + ":" + candidate.colorId] = candidate;
    }
    const seenCodes = new Set();
    const japanTargets = [];
    for (const item of japan) {
      if ((item.relatedNames || []).length) continue;
      const brand = String(item.brandItemNumber || "").match(/(\d{8})\s+([A-Za-z0-9]+)/);
      if (!brand || seenCodes.has(brand[1])) continue;
      seenCodes.add(brand[1]);
      japanTargets.push({ code: brand[1], color: brand[2] });
    }
    return { knownProducts: (previous && previous.products) || [], knownCandidates, japanTargets };
  }
  const opener = {
    focus() {},
    postMessage(message) {
      if (!message) return;
      if (message.type === "mango-global-context-request") {
        setTimeout(() => window.dispatchEvent(new MessageEvent("message", { origin: ORIGIN, data: Object.assign({ type: "mango-global-context" }, buildContext()) })), 0);
      } else if (message.type === "mango-global-progress") {
        state.progress = message.text;
        state.steps += 1;
      } else if (message.type === "mango-global-error") {
        state.error = message.text || "unknown error";
      } else if (message.type === "mango-global-raw") {
        state.raw = message.raw;
      }
    }
  };
  try { Object.defineProperty(window, "opener", { value: opener, configurable: true }); } catch (e) { window.opener = opener; }
  return window.opener === opener;
})()
'@

$chrome = $null
$exitCode = 0
try {
  Log "start (DryRun=$DryRun)"
  $today = (Get-Date).ToString("yyyy-MM-dd")
  if (-not $Force -and -not $DryRun -and (Test-Path $OkFile) -and ((Get-Content $OkFile -ErrorAction SilentlyContinue) -eq $today)) {
    Log "already succeeded today; skipping"
    return
  }

  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  Log "downloading current data from the site"
  $previousText = $null
  try { $previousText = Download-Text "${SiteBase}global-products.json?v=$stamp" } catch { Log "global-products.json unavailable: $($_.Exception.Message)" }
  $japanText = $null
  foreach ($name in @("japan-index.json", "products.json")) {
    try { $japanText = Download-Text "${SiteBase}${name}?v=$stamp"; break } catch { Log "$name unavailable: $($_.Exception.Message)" }
  }
  if (-not $japanText) { throw "Japan product data could not be downloaded" }
  $collectorJs = Download-Text "${SiteBase}tools/collect-global.js?v=$stamp"

  $chromePath = Find-Chrome
  Log "launching Chrome: $chromePath"
  $chrome = Start-Process -FilePath $chromePath -PassThru -ArgumentList @(
    "--remote-debugging-port=$Port", "--remote-allow-origins=*", "--user-data-dir=`"$ChromeProfile`"",
    "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "about:blank")

  $debuggerUrl = $null
  for ($i = 0; $i -lt 30 -and -not $debuggerUrl; $i += 1) {
    Start-Sleep -Seconds 1
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 5
      $page = @($targets | Where-Object { $_.type -eq "page" })[0]
      if ($page) { $debuggerUrl = $page.webSocketDebuggerUrl }
    } catch {}
  }
  if (-not $debuggerUrl) { throw "could not connect to Chrome" }

  $script:ws = New-Object System.Net.WebSockets.ClientWebSocket
  $script:ws.ConnectAsync([Uri]$debuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  Invoke-Cdp "Page.enable" | Out-Null
  Invoke-Cdp "Page.bringToFront" | Out-Null

  Log "opening $StartUrl"
  Invoke-Cdp "Page.navigate" @{ url = $StartUrl } | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 40 -and -not $ready; $i += 1) {
    Start-Sleep -Seconds 3
    try {
      $state = Eval-Js 'JSON.stringify({ host: location.host, ready: document.readyState, title: document.title, links: document.querySelectorAll(''a[href*="/gb/en/p/"]'').length })'
      $info = $state | ConvertFrom-Json
      if ($info.host -eq "shop.mango.com" -and $info.ready -eq "complete" -and $info.links -gt 0) { $ready = $true }
      elseif ($i % 5 -eq 4) { Log "waiting for the page (host=$($info.host) title=$($info.title) links=$($info.links))" }
    } catch { }
  }
  if (-not $ready) { throw "the MANGO page did not show products (blocked or not loaded)" }
  Log "page ready"

  Eval-Js "window.__ctxSrc = { previous: $(if ($previousText) { $previousText } else { 'null' }), japan: $japanText }; true" 120000 | Out-Null
  $stubOk = Eval-Js $StubJs
  if ($stubOk -ne $true) { throw "could not install the opener stub" }

  # Start the collector without waiting; poll the stub for progress/result.
  Invoke-Cdp "Runtime.evaluate" @{ expression = $collectorJs; awaitPromise = $false } 60000 | Out-Null
  Log "collector started"

  $deadline = (Get-Date).AddMinutes($MaxMinutes)
  $lastProgress = ""
  $lastLogged = Get-Date
  $rawJson = $null
  while ((Get-Date) -lt $deadline -and -not $rawJson) {
    Start-Sleep -Seconds 10
    $poll = (Eval-Js "JSON.stringify({ done: Boolean(window.__auto.raw), error: window.__auto.error, progress: window.__auto.progress })" | ConvertFrom-Json)
    $lastProgress = $poll.progress
    if (((Get-Date) - $lastLogged).TotalSeconds -ge 60) { Log "progress: $lastProgress"; $lastLogged = Get-Date }
    if ($poll.error) { throw "collector failed: $($poll.error)" }
    if ($poll.done) { $rawJson = Eval-Js "JSON.stringify(window.__auto.raw)" 180000 }
  }
  if (-not $rawJson) { throw "timed out after $MaxMinutes minutes (last: $lastProgress)" }

  $raw = $rawJson | ConvertFrom-Json
  $productCount = @($raw.products).Count
  Log "collected $productCount products (last: $lastProgress)"

  if ($DryRun) {
    $out = Join-Path $Dir "global-raw-dryrun.json"
    [System.IO.File]::WriteAllText($out, $rawJson, (New-Object System.Text.UTF8Encoding($false)))
    Log "dry run: saved $out"
  } else {
    $body = [System.Text.Encoding]::UTF8.GetBytes('{"raw":' + $rawJson + '}')
    $published = $false
    for ($attempt = 0; $attempt -lt 3 -and -not $published; $attempt += 1) {
      $response = Invoke-RestMethod -Uri $RelayUrl -Method Post -ContentType "text/plain;charset=utf-8" -Body $body -TimeoutSec 180
      if ($response.ok) { $published = $true; break }
      $message = [string]$response.error
      if ($message -match "(\d+)") {
        $wait = [int]$Matches[1] * 60 + 5
        Log "relay asked to wait: $message"
        Start-Sleep -Seconds $wait
      } else { throw "relay rejected: $message" }
    }
    if (-not $published) { throw "relay did not accept the data" }
    Log "published to the relay; the site updates in a few minutes"
    Set-Content -Path $OkFile -Value $today
  }
} catch {
  Log "FAILED: $($_.Exception.Message)"
  $exitCode = 1
} finally {
  try { if ($script:ws) { Invoke-Cdp "Browser.close" @{} 5000 | Out-Null } } catch {}
  Start-Sleep -Seconds 2
  if ($chrome -and -not $chrome.HasExited) { try { Stop-Process -Id $chrome.Id -Force } catch {} }
  Log "end (exit $exitCode)"
}
exit $exitCode
