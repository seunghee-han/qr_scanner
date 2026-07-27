import {
  SnapshotAccumulator,
  formatBytes,
  parseSnapshotQrPayload,
} from './protocol.js?v=20260727-split-2x1';
import {
  hasReadableVideoFrame,
  requestCameraStream,
  startVideoElement,
} from './camera.js';

const els = {
  video: document.querySelector('#previewVideo'),
  videoFrame: document.querySelector('#videoFrame'),
  overlay: document.querySelector('#cameraOverlay'),
  start: document.querySelector('#startButton'),
  stop: document.querySelector('#stopButton'),
  torch: document.querySelector('#torchButton'),
  reset: document.querySelector('#resetButton'),
  status: document.querySelector('#statusLine'),
  scanState: document.querySelector('#scanStateBadge'),
  scanModeText: document.querySelector('#scanModeText'),
  scanModeButtons: Array.from(document.querySelectorAll('[data-scan-mode-button]')),
  supportBadge: document.querySelector('#supportBadge'),
  networkBadge: document.querySelector('#networkBadge'),
  percent: document.querySelector('#percentText'),
  progressBar: document.querySelector('#progressBar'),
  received: document.querySelector('#receivedText'),
  missing: document.querySelector('#missingText'),
  bytes: document.querySelector('#bytesText'),
  mime: document.querySelector('#mimeText'),
  request: document.querySelector('#requestText'),
  lastPacket: document.querySelector('#lastPacketText'),
  resultPanel: document.querySelector('#resultPanel'),
  resultName: document.querySelector('#resultName'),
  resultImage: document.querySelector('#resultImage'),
  downloadLink: document.querySelector('#downloadLink'),
  hashText: document.querySelector('#hashText'),
  genericPanel: document.querySelector('#genericPanel'),
  genericText: document.querySelector('#genericText'),
  copyGeneric: document.querySelector('#copyGenericButton'),
};

const SCAN_MODE_SINGLE = 'single';
const SCAN_MODE_SPLIT_2X1 = 'split-2x1';
const SCAN_MODE_LABELS = {
  [SCAN_MODE_SINGLE]: '1개',
  [SCAN_MODE_SPLIT_2X1]: '2x1',
};

const accumulator = new SnapshotAccumulator();
let detector = null;
let detectorMode = 'none';
let stream = null;
let scanning = false;
let scanBusy = false;
let scanCanvas = null;
let scanContext = null;
let scanMode = SCAN_MODE_SINGLE;
let torchEnabled = false;
let resultUrl = '';
let assembledRequestId = '';
let waitingForVideoFrame = false;
let lastRawValue = '';
let lastRawSeenAt = 0;
const DUPLICATE_RAW_SUPPRESS_MS = 1200;

function setBadge(el, text, kind = '') {
  el.textContent = text;
  el.className = `badge${kind ? ` ${kind}` : ''}`;
}

function setStartButtonState(state) {
  els.start.classList.toggle('is-busy', state === 'busy');
  els.start.classList.toggle('is-active', state === 'active');
  els.start.disabled = state !== 'idle';

  if (state === 'busy') {
    els.start.textContent = '시작 중';
  } else if (state === 'active') {
    els.start.textContent = '스캔 중';
  } else {
    els.start.textContent = '카메라 시작';
  }
}

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status-line${kind ? ` ${kind}` : ''}`;
  els.scanState.textContent = text;
  els.scanState.className = `scan-state${kind ? ` ${kind}` : ' is-idle'}`;
}

function setScanMode(nextMode) {
  scanMode = nextMode === SCAN_MODE_SPLIT_2X1 ? SCAN_MODE_SPLIT_2X1 : SCAN_MODE_SINGLE;
  const label = SCAN_MODE_LABELS[scanMode];
  els.videoFrame.dataset.scanMode = scanMode;
  els.scanModeText.textContent = label;
  for (const button of els.scanModeButtons) {
    const active = button.dataset.scanModeButton === scanMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  if (scanning) setStatus(`스캔 중 (${label})`, 'is-working');
}

function showCameraOverlay(text) {
  els.overlay.hidden = false;
  els.overlay.style.removeProperty('display');
  els.overlay.textContent = text;
}

function hideCameraOverlay() {
  els.overlay.hidden = true;
  els.overlay.style.display = 'none';
}

function truncateText(value, max = 900) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function fileExtensionFromMime(mime) {
  const value = String(mime || '').toLowerCase();
  if (value.includes('webp')) return 'webp';
  if (value.includes('png')) return 'png';
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg';
  return 'bin';
}

function cameraErrorMessage(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return '카메라 권한이 차단됨: 브라우저 주소창/설정에서 카메라 허용 필요';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '카메라를 찾을 수 없음';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '카메라를 열 수 없음: 다른 앱에서 카메라 사용 중일 수 있음';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return '요청한 카메라 조건을 지원하지 않음';
  }
  if (name === 'SecurityError') {
    return '카메라 보안 제한: HTTPS 주소를 Safari/Chrome에서 직접 열어야 함';
  }
  return error instanceof Error ? error.message : '카메라 시작 실패';
}

function resetResult() {
  if (resultUrl) URL.revokeObjectURL(resultUrl);
  resultUrl = '';
  assembledRequestId = '';
  els.resultPanel.hidden = true;
  els.resultImage.removeAttribute('src');
  els.downloadLink.removeAttribute('href');
  els.hashText.textContent = '';
}

function renderProgress() {
  const progress = accumulator.getProgress();
  els.percent.textContent = `${progress.percent.toFixed(progress.total ? 1 : 0)}%`;
  els.progressBar.style.width = `${progress.percent}%`;
  els.received.textContent = progress.total ? `${progress.received} / ${progress.total}` : '0 / -';
  els.bytes.textContent = progress.byteLength ? formatBytes(progress.byteLength) : '-';
  els.mime.textContent = progress.mime || '-';
  els.request.textContent = progress.requestId || '-';
  els.lastPacket.textContent = progress.lastSeq ? `${progress.lastSeq}` : '-';

  if (!progress.total) {
    els.missing.textContent = '-';
  } else if (progress.missing === 0) {
    els.missing.textContent = '0';
  } else {
    const suffix = progress.missing > progress.missingSeqs.length ? '...' : '';
    els.missing.textContent = `${progress.missing} (${progress.missingSeqs.join(', ')}${suffix})`;
  }
}

async function renderCompletedImage() {
  const progress = accumulator.getProgress();
  if (!progress.completed || assembledRequestId === progress.requestId) return;
  assembledRequestId = progress.requestId;
  try {
    const assembled = await accumulator.assemble();
    resetResult();
    assembledRequestId = assembled.requestId;
    const blob = new Blob([assembled.bytes], { type: assembled.mime });
    resultUrl = URL.createObjectURL(blob);
    const ext = fileExtensionFromMime(assembled.mime);
    const filename = `snapshot-${assembled.requestId}.${ext}`;
    els.resultName.textContent = filename;
    els.resultImage.src = resultUrl;
    els.downloadLink.href = resultUrl;
    els.downloadLink.download = filename;
    els.hashText.textContent = assembled.sha256 ? `SHA-256 ${assembled.sha256}` : '';
    els.resultPanel.hidden = false;
    setStatus('복원 완료', 'is-ready');
    if (navigator.vibrate) navigator.vibrate([60, 30, 60]);
  } catch (error) {
    assembledRequestId = '';
    setStatus(error instanceof Error ? error.message : '복원 실패', 'is-error');
  }
}

async function handleRawQr(rawValue) {
  const rawText = String(rawValue || '').trim();
  const now = Date.now();
  if (rawText && rawText === lastRawValue && now - lastRawSeenAt < DUPLICATE_RAW_SUPPRESS_MS) {
    return;
  }
  lastRawValue = rawText;
  lastRawSeenAt = now;

  const packet = parseSnapshotQrPayload(rawText);
  if (!packet) {
    els.genericPanel.hidden = false;
    els.genericText.textContent = truncateText(rawValue);
    setStatus('일반 QR 감지');
    return;
  }

  els.genericPanel.hidden = true;
  const result = accumulator.addPacket(packet);
  renderProgress();

  if (!result.accepted) {
    setStatus(result.reason === 'crc' ? 'CRC 오류' : '다른 QR 섞임', 'is-error');
    return;
  }

  if (!result.duplicate) {
    setStatus(`현재 QR ${packet.seq} / ${packet.total}`, 'is-working');
  }

  if (result.complete) {
    await renderCompletedImage();
  }
}

async function ingestBarcodes(barcodes) {
  let detected = false;
  for (const barcode of barcodes) {
    if (barcode.rawValue) {
      detected = true;
      await handleRawQr(barcode.rawValue);
    }
  }
  return detected;
}

async function scanNativeFrame() {
  if (scanMode !== SCAN_MODE_SPLIT_2X1) {
    return ingestBarcodes(await detector.detect(els.video));
  }

  const sourceWidth = els.video.videoWidth || 0;
  const sourceHeight = els.video.videoHeight || 0;
  if (!sourceWidth || !sourceHeight) return false;

  let detected = false;
  for (const region of getScanRegions(sourceWidth, sourceHeight)) {
    const { canvas } = drawVideoRect(region, 2400);
    if (await ingestBarcodes(await detector.detect(canvas))) detected = true;
  }
  return detected;
}

function getScanCanvasContext(width, height) {
  if (!scanCanvas) scanCanvas = document.createElement('canvas');
  if (!scanContext) {
    scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!scanContext) throw new Error('카메라 프레임을 읽을 수 없습니다');

  if (scanCanvas.width !== width || scanCanvas.height !== height) {
    scanCanvas.width = width;
    scanCanvas.height = height;
  }
  scanContext.imageSmoothingEnabled = false;
  return scanContext;
}

function centeredRect(region, ratio) {
  const width = Math.max(1, Math.round(region.sw * ratio));
  const height = Math.max(1, Math.round(region.sh * ratio));
  return {
    sx: region.sx + Math.max(0, Math.round((region.sw - width) / 2)),
    sy: region.sy + Math.max(0, Math.round((region.sh - height) / 2)),
    sw: width,
    sh: height,
  };
}

function squareCenterRect(region, ratio) {
  const side = Math.max(1, Math.round(Math.min(region.sw, region.sh) * ratio));
  return {
    sx: region.sx + Math.max(0, Math.round((region.sw - side) / 2)),
    sy: region.sy + Math.max(0, Math.round((region.sh - side) / 2)),
    sw: side,
    sh: side,
  };
}

function getScanRegions(sourceWidth, sourceHeight) {
  if (scanMode !== SCAN_MODE_SPLIT_2X1) {
    return [{ sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight }];
  }
  const leftWidth = Math.max(1, Math.floor(sourceWidth / 2));
  return [
    { sx: 0, sy: 0, sw: leftWidth, sh: sourceHeight },
    { sx: leftWidth, sy: 0, sw: Math.max(1, sourceWidth - leftWidth), sh: sourceHeight },
  ];
}

function getJsQrCandidates(region) {
  return [
    region,
    squareCenterRect(region, 1),
    centeredRect(region, 0.82),
    squareCenterRect(region, 0.78),
    centeredRect(region, 0.64),
    squareCenterRect(region, 0.58),
    centeredRect(region, 0.48),
  ];
}

function drawVideoRect(rect, targetMaxSide) {
  const scale = Math.min(1, targetMaxSide / Math.max(rect.sw, rect.sh));
  const width = Math.max(1, Math.round(rect.sw * scale));
  const height = Math.max(1, Math.round(rect.sh * scale));
  const ctx = getScanCanvasContext(width, height);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(els.video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);
  return { canvas: scanCanvas, width, height, ctx };
}

function scanJsQrCandidate(rect, targetMaxSide) {
  const { width, height, ctx } = drawVideoRect(rect, targetMaxSide);
  const imageData = ctx.getImageData(0, 0, width, height);
  return window.jsQR(imageData.data, width, height, {
    inversionAttempts: 'attemptBoth',
  });
}

async function scanJsQrFrame() {
  if (typeof window.jsQR !== 'function') {
    throw new Error('모바일 QR 디코더를 불러오지 못했습니다');
  }

  const sourceWidth = els.video.videoWidth || 0;
  const sourceHeight = els.video.videoHeight || 0;
  if (!sourceWidth || !sourceHeight) return false;

  for (const region of getScanRegions(sourceWidth, sourceHeight)) {
    for (const rect of getJsQrCandidates(region)) {
      const code = scanJsQrCandidate(rect, 1920);
      if (code?.data) {
        await handleRawQr(code.data);
        return true;
      }
    }
  }
  return false;
}

async function scanFrame() {
  if (!scanning) return;
  const videoReady = hasReadableVideoFrame(els.video);
  if (waitingForVideoFrame && videoReady) {
    waitingForVideoFrame = false;
    setStatus(`스캔 중 (${SCAN_MODE_LABELS[scanMode]})`, 'is-working');
  }

  if (!scanBusy && detectorMode !== 'none' && videoReady) {
    scanBusy = true;
    try {
      let detected = false;
      if (detector && (detectorMode === 'native' || detectorMode === 'hybrid')) {
        detected = await scanNativeFrame();
      }
      if (!detected && (detectorMode === 'jsqr' || detectorMode === 'hybrid')) {
        await scanJsQrFrame();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'QR 감지 실패', 'is-error');
    } finally {
      scanBusy = false;
    }
  }
  const intervalMs = detectorMode === 'jsqr' || detectorMode === 'hybrid' ? 180 : 90;
  window.setTimeout(() => window.requestAnimationFrame(scanFrame), intervalMs);
}

async function initDetector() {
  detector = null;
  detectorMode = 'none';

  if ('BarcodeDetector' in window) {
    try {
      if (typeof BarcodeDetector.getSupportedFormats === 'function') {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (!formats.includes('qr_code')) {
          throw new Error('BarcodeDetector QR format unsupported');
        }
      }
      detector = new BarcodeDetector({ formats: ['qr_code'] });
      detectorMode = typeof window.jsQR === 'function' ? 'hybrid' : 'native';
      setBadge(els.supportBadge, detectorMode === 'hybrid' ? 'QR 고감도' : 'QR 지원', 'badge-ready');
      return;
    } catch (error) {
      console.warn('Native QR scanner unavailable; using jsQR fallback', error);
    }
  }

  if (typeof window.jsQR === 'function') {
    detectorMode = 'jsqr';
    setBadge(els.supportBadge, '모바일 QR 지원', 'badge-ready');
    return;
  }

  setBadge(els.supportBadge, 'QR 미지원', 'badge-error');
  throw new Error('이 브라우저는 QR 스캔을 지원하지 않습니다');
}

async function startCamera() {
  if (stream) stopCamera();
  setStartButtonState('busy');
  showCameraOverlay('카메라 권한 확인 중');
  setStatus('카메라 권한 확인 중', 'is-working');

  stream = await requestCameraStream();
  els.video.srcObject = stream;
  waitingForVideoFrame = !hasReadableVideoFrame(els.video);
  hideCameraOverlay();

  scanning = true;
  setStartButtonState('active');
  setStatus(waitingForVideoFrame ? '카메라 연결됨 - 영상 준비 중' : `스캔 중 (${SCAN_MODE_LABELS[scanMode]})`, 'is-working');
  window.requestAnimationFrame(scanFrame);

  startVideoElement(els.video).then((videoStartup) => {
    if (!scanning) return;
    waitingForVideoFrame = !videoStartup.ready && !hasReadableVideoFrame(els.video);
    if (!waitingForVideoFrame) setStatus(`스캔 중 (${SCAN_MODE_LABELS[scanMode]})`, 'is-working');
  }).catch((error) => {
    if (!scanning) return;
    setStatus(error instanceof Error ? error.message : '영상 재생 실패', 'is-error');
  });

  if (detectorMode === 'none') {
    try {
      await initDetector();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'QR 미지원', 'is-error');
    }
  }
}

function stopCamera() {
  scanning = false;
  waitingForVideoFrame = false;
  torchEnabled = false;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  stream = null;
  els.video.srcObject = null;
  showCameraOverlay('카메라 대기');
  setStartButtonState('idle');
  setStatus('정지됨');
}

async function toggleTorch() {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) {
    setStatus('카메라가 꺼져 있습니다', 'is-error');
    return;
  }
  const capabilities = track.getCapabilities?.() || {};
  if (!('torch' in capabilities)) {
    setStatus('조명을 지원하지 않습니다', 'is-error');
    return;
  }
  torchEnabled = !torchEnabled;
  await track.applyConstraints({ advanced: [{ torch: torchEnabled }] });
  setStatus(torchEnabled ? '조명 켜짐' : '조명 꺼짐');
}

function resetScan() {
  accumulator.reset();
  resetResult();
  els.genericPanel.hidden = true;
  els.genericText.textContent = '';
  renderProgress();
  setStatus(scanning ? `스캔 중 (${SCAN_MODE_LABELS[scanMode]})` : '대기 중', scanning ? 'is-working' : '');
}

function updateNetworkBadge() {
  if (navigator.onLine) {
    setBadge(els.networkBadge, '온라인', 'badge-muted');
  } else {
    setBadge(els.networkBadge, '오프라인', 'badge-ready');
  }
}

async function copyGenericQr() {
  const value = els.genericText.textContent || '';
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setStatus('복사됨');
  } catch {
    setStatus('복사 실패', 'is-error');
  }
}

async function boot() {
  setStartButtonState('idle');
  setScanMode(SCAN_MODE_SINGLE);
  renderProgress();
  updateNetworkBadge();
  window.addEventListener('online', updateNetworkBadge);
  window.addEventListener('offline', updateNetworkBadge);

  try {
    await initDetector();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'QR 미지원', 'is-error');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

els.start.addEventListener('click', () => {
  startCamera().catch((error) => {
    setStartButtonState('idle');
    showCameraOverlay('카메라 오류');
    setStatus(cameraErrorMessage(error), 'is-error');
  });
});
els.stop.addEventListener('click', stopCamera);
els.torch.addEventListener('click', () => {
  toggleTorch().catch((error) => setStatus(error instanceof Error ? error.message : '조명 실패', 'is-error'));
});
els.reset.addEventListener('click', resetScan);
for (const button of els.scanModeButtons) {
  button.addEventListener('click', () => setScanMode(button.dataset.scanModeButton));
}
els.copyGeneric.addEventListener('click', copyGenericQr);
window.addEventListener('pagehide', () => {
  stopCamera();
  resetResult();
});

void boot();
