# Lessons

- The scanner must remain independent from any one server. Compatibility belongs to the `ISQ1` QR payload contract, not to a backend API.
- Browser camera scanning needs HTTPS except localhost, so public/static hosting is the practical path for phone testing.
- iOS browsers may not expose `BarcodeDetector` for QR scanning; phone-side scanning needs a JavaScript decoder fallback, not only the native browser API.
- Mobile camera startup should not depend on QR decoder initialization; turn on the camera first, then report decoder issues separately.
- Version the app module URL when changing startup behavior, because an old service worker can serve a stale cached module even when the page URL has a query string.
- Mobile camera startup must not await `video.play()` indefinitely; use video readiness events plus a bounded timeout so the UI can leave the waiting overlay.
- Mobile camera permission requests can hang after Allow; wrap `getUserMedia()` in a timeout and retry only recoverable constraint failures.
