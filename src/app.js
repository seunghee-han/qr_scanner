import {
  SnapshotAccumulator,
  formatBytes,
  parseSnapshotQrPayload,
} from './protocol.js';

const els = {
  video: document.querySelector('#previewVideo'),
  overlay: document.querySelector('#cameraOverlay'),
  start: document.querySelector('#startButton'),
  stop: document.querySelector('#stopButton'),
  torch: document.querySelector('#torchButton'),
  reset: document.querySelector('#resetButton'),
  status: document.querySelector('#statusLine'),
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

const accumulator = new SnapshotAccumulator();
let detector = null;
let stream = null;
let scanning = false;
let scanBusy = false;
let torchEnabled = false;
let resultUrl = '';
let assembledRequestId = '';

function setBadge(el, text, kind = '') {
  el.textContent = text;
  el.className = `badge${kind ? ` ${kind}` : ''}`;
}

function setStatus(text, kind = '') {
  els.status.textContent = text;
  els.status.className = `status-line${kind ? ` ${kind}` : ''}`;
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
  const packet = parseSnapshotQrPayload(rawValue);
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

  if (result.duplicate) {
    setStatus(`중복 QR ${packet.seq}`);
  } else {
    setStatus(`수신 ${packet.seq} / ${packet.total}`, 'is-working');
  }

  if (result.complete) {
    await renderCompletedImage();
  }
}

async function scanFrame() {
  if (!scanning) return;
  if (!scanBusy && detector && els.video.readyState >= 2) {
    scanBusy = true;
    try {
      const barcodes = await detector.detect(els.video);
      for (const barcode of barcodes) {
        if (barcode.rawValue) await handleRawQr(barcode.rawValue);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'QR 감지 실패', 'is-error');
    } finally {
      scanBusy = false;
    }
  }
  window.setTimeout(() => window.requestAnimationFrame(scanFrame), 70);
}

async function initDetector() {
  if (!('BarcodeDetector' in window)) {
    setBadge(els.supportBadge, 'QR 미지원', 'badge-error');
    throw new Error('이 브라우저는 QR 스캔을 지원하지 않습니다');
  }
  detector = new BarcodeDetector({ formats: ['qr_code'] });
  setBadge(els.supportBadge, 'QR 지원', 'badge-ready');
}

async function startCamera() {
  if (!detector) await initDetector();
  if (stream) stopCamera();

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  els.video.srcObject = stream;
  await els.video.play();
  els.overlay.hidden = true;
  scanning = true;
  setStatus('스캔 중', 'is-working');
  window.requestAnimationFrame(scanFrame);
}

function stopCamera() {
  scanning = false;
  torchEnabled = false;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  stream = null;
  els.video.srcObject = null;
  els.overlay.hidden = false;
  els.overlay.textContent = '카메라 대기';
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
  setStatus(scanning ? '스캔 중' : '대기 중', scanning ? 'is-working' : '');
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
    els.overlay.hidden = false;
    els.overlay.textContent = '카메라 오류';
    setStatus(error instanceof Error ? error.message : '카메라 시작 실패', 'is-error');
  });
});
els.stop.addEventListener('click', stopCamera);
els.torch.addEventListener('click', () => {
  toggleTorch().catch((error) => setStatus(error instanceof Error ? error.message : '조명 실패', 'is-error'));
});
els.reset.addEventListener('click', resetScan);
els.copyGeneric.addEventListener('click', copyGenericQr);
window.addEventListener('pagehide', () => {
  stopCamera();
  resetResult();
});

void boot();
