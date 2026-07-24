# Lessons

- The scanner must remain independent from any one server. Compatibility belongs to the `ISQ1` QR payload contract, not to a backend API.
- Browser camera scanning needs HTTPS except localhost, so public/static hosting is the practical path for phone testing.
- iOS browsers may not expose `BarcodeDetector` for QR scanning; phone-side scanning needs a JavaScript decoder fallback, not only the native browser API.
