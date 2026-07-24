export const DEFAULT_VIDEO_START_TIMEOUT_MS = 1800;
export const DEFAULT_CAMERA_REQUEST_TIMEOUT_MS = 7000;

export class CameraRequestTimeoutError extends Error {
  constructor(timeoutMs = DEFAULT_CAMERA_REQUEST_TIMEOUT_MS) {
    super(`카메라 응답 없음: 권한 허용 후 ${Math.round(timeoutMs / 1000)}초 안에 카메라가 열리지 않았습니다`);
    this.name = 'CameraRequestTimeoutError';
  }
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop();
}

function getUserMediaWithTimeout(constraints, timeoutMs) {
  let settled = false;
  let timeoutId = 0;

  const request = navigator.mediaDevices.getUserMedia(constraints)
    .then((requestedStream) => {
      if (settled) {
        stopStream(requestedStream);
        return null;
      }
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      return requestedStream;
    })
    .catch((error) => {
      if (settled) return null;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      throw error;
    });

  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new CameraRequestTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([request, timeout]).then((requestedStream) => {
    if (!requestedStream) throw new CameraRequestTimeoutError(timeoutMs);
    return requestedStream;
  });
}

export async function requestCameraStream({ timeoutMs = DEFAULT_CAMERA_REQUEST_TIMEOUT_MS } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('이 브라우저는 카메라 API를 지원하지 않습니다');
  }

  const attempts = [
    {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    {
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    },
    {
      audio: false,
      video: true,
    },
  ];

  let lastError = null;
  for (const constraints of attempts) {
    try {
      return await getUserMediaWithTimeout(constraints, timeoutMs);
    } catch (error) {
      lastError = error;
      if (error?.name === 'CameraRequestTimeoutError'
        || error?.name === 'NotAllowedError'
        || error?.name === 'PermissionDeniedError'
        || error?.name === 'NotFoundError'
        || error?.name === 'DevicesNotFoundError'
        || error?.name === 'NotReadableError'
        || error?.name === 'TrackStartError'
        || error?.name === 'SecurityError') {
        throw error;
      }
    }
  }

  throw lastError || new Error('카메라 시작 실패');
}

export function hasReadableVideoFrame(video) {
  return Number(video?.readyState || 0) >= 2
    && Number(video?.videoWidth || 0) > 0
    && Number(video?.videoHeight || 0) > 0;
}

export function waitForVideoReadiness(video, { timeoutMs = DEFAULT_VIDEO_START_TIMEOUT_MS } = {}) {
  if (hasReadableVideoFrame(video)) {
    return Promise.resolve({ ready: true, reason: 'already-ready' });
  }

  const eventNames = ['loadedmetadata', 'loadeddata', 'canplay', 'playing'];
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = 0;

    const finish = (reason) => {
      if (settled) return;
      settled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      for (const eventName of eventNames) {
        video.removeEventListener(eventName, onReadyEvent);
      }
      resolve({ ready: hasReadableVideoFrame(video), reason });
    };

    const onReadyEvent = (event) => finish(event.type);

    for (const eventName of eventNames) {
      video.addEventListener(eventName, onReadyEvent, { once: true });
    }
    timeoutId = window.setTimeout(() => finish('timeout'), timeoutMs);
  });
}

export async function startVideoElement(video, { timeoutMs = DEFAULT_VIDEO_START_TIMEOUT_MS } = {}) {
  if (!video) throw new Error('video element is required');

  video.setAttribute?.('playsinline', '');
  video.playsInline = true;
  video.muted = true;

  const readinessPromise = waitForVideoReadiness(video, { timeoutMs });
  const playResult = video.play?.();
  const playPromise = playResult && typeof playResult.then === 'function'
    ? playResult.then(() => ({ ready: hasReadableVideoFrame(video), reason: 'play' }))
    : Promise.resolve({ ready: hasReadableVideoFrame(video), reason: 'play-unavailable' });

  return Promise.race([playPromise, readinessPromise]);
}
