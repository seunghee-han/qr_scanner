import assert from 'node:assert/strict';
import {
  CameraRequestTimeoutError,
  hasReadableVideoFrame,
  requestCameraStream,
  startVideoElement,
  waitForVideoReadiness,
} from '../src/camera.js';

if (!globalThis.window) {
  globalThis.window = {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
  };
}

class FakeVideo extends EventTarget {
  constructor(playImpl) {
    super();
    this.attributes = new Map();
    this.muted = false;
    this.playsInline = false;
    this.readyState = 0;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.playImpl = playImpl;
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  play() {
    return this.playImpl();
  }
}

const stalledVideo = new FakeVideo(() => new Promise(() => {}));
const startedAt = Date.now();
const stalledResult = await startVideoElement(stalledVideo, { timeoutMs: 20 });
assert.equal(stalledResult.ready, false);
assert.equal(stalledResult.reason, 'timeout');
assert.ok(Date.now() - startedAt < 200);
assert.equal(stalledVideo.muted, true);
assert.equal(stalledVideo.playsInline, true);
assert.equal(stalledVideo.attributes.get('playsinline'), '');

const eventVideo = new FakeVideo(() => new Promise(() => {}));
const eventPromise = startVideoElement(eventVideo, { timeoutMs: 200 });
window.setTimeout(() => {
  eventVideo.readyState = 2;
  eventVideo.videoWidth = 640;
  eventVideo.videoHeight = 480;
  eventVideo.dispatchEvent(new Event('loadeddata'));
}, 10);
const eventResult = await eventPromise;
assert.equal(eventResult.ready, true);
assert.equal(eventResult.reason, 'loadeddata');

const rejectedVideo = new FakeVideo(() => Promise.reject(new Error('play denied')));
await assert.rejects(
  () => startVideoElement(rejectedVideo, { timeoutMs: 200 }),
  /play denied/,
);

const readyVideo = new FakeVideo(() => Promise.resolve());
readyVideo.readyState = 2;
readyVideo.videoWidth = 320;
readyVideo.videoHeight = 240;
assert.equal(hasReadableVideoFrame(readyVideo), true);
assert.deepEqual(await waitForVideoReadiness(readyVideo), {
  ready: true,
  reason: 'already-ready',
});

const originalNavigator = globalThis.navigator;
let mediaRequests = [];
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: (constraints) => {
        mediaRequests.push(constraints);
        if (mediaRequests.length === 1) {
          return Promise.reject(Object.assign(new Error('bad constraints'), { name: 'OverconstrainedError' }));
        }
        return Promise.resolve({ getTracks: () => [] });
      },
    },
  },
});
const fallbackStream = await requestCameraStream({ timeoutMs: 50 });
assert.ok(fallbackStream);
assert.equal(mediaRequests.length, 2);
assert.deepEqual(mediaRequests[1], {
  audio: false,
  video: { facingMode: { ideal: 'environment' } },
});

mediaRequests = [];
globalThis.navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
await assert.rejects(
  () => requestCameraStream({ timeoutMs: 20 }),
  CameraRequestTimeoutError,
);
assert.equal(mediaRequests.length, 0);

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: originalNavigator,
});

console.log('camera startup ok');
