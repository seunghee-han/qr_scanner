# qr_scanner

`qr_scanner` is a standalone phone-side scanner for animated snapshot QR transfer.
It is not tied to one server. Any service that emits the same `ISQ1` payload format can use this scanner.

## Payload Format

```text
ISQ1|requestId|seq|total|crc32|sha256|imageByteLen|mime|base64chunk
```

The scanner:

- validates each chunk with CRC32
- groups chunks by `requestId`
- reassembles bytes only when all chunks are present
- validates the final image with SHA-256
- creates a browser-only download link

Generic QR text is displayed, but image restoration only works for `ISQ1` chunks.

## Run Locally

```bash
cd /home/user/qr_scanner
npm test
npm run serve
```

Open this on the same machine:

```text
http://127.0.0.1:8088/
```

Phone camera access generally requires HTTPS, except for `localhost`. For phone testing, deploy as a static HTTPS site.

## GitHub Pages

After pushing this repo to GitHub:

1. Go to repository Settings.
2. Open Pages.
3. Select `main` branch and `/ (root)`.
4. Open the published HTTPS URL on the phone.

## Privacy Notes

The app has no runtime dependency on the closed-network server. It only reads QR codes through the phone camera.
Image bytes stay in browser memory until reset/reload. The app does not upload reconstructed images.

The service worker caches only same-origin static app files so the page can continue opening after the first load.
