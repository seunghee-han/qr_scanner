# QR Scanner PWA

## Acceptance Criteria
- [x] 독립 폴더 `/home/user/qr_scanner`에서 운영 서비스와 분리된다.
- [x] `ISQ1|requestId|seq|total|crc32|sha256|byteLength|mime|base64` QR payload를 읽는다.
- [x] QR chunk를 CRC32로 검증하고 전체 이미지를 SHA-256으로 검증한다.
- [x] 브라우저 메모리에서 이미지를 복원하고 다운로드 링크를 제공한다.
- [x] 일반 QR 텍스트도 표시한다.
- [x] 네트워크 업로드/외부 API 의존성이 없다.
- [x] 모바일 브라우저용 QR 스캔 fallback을 제공한다.
- [x] 로컬 테스트, Git 초기화, GitHub 원격 생성/푸시를 완료한다.

## Progress
- [x] 프로젝트 구조 생성.
- [x] 정적 PWA UI 구현.
- [x] 공통 프로토콜 모듈 구현.
- [x] 프로토콜 테스트 스크립트 추가.
- [x] 모바일 QR fallback 구현.
- [x] 로컬 문법/프로토콜 검증.
- [x] GitHub Pages 반영 확인.
- [ ] 폰 실기기 카메라 스캔 확인.
- [x] 폰 카메라 시작 실패 시 명확한 상태 메시지를 보여준다.
- [x] 모바일 `video.play()` 대기 상태가 카메라 시작 UI를 막지 않는다.
- [x] 모바일 `getUserMedia()` 무응답이 권한 확인 UI를 무한 대기시키지 않는다.
- [x] 기존 폰 service worker 캐시를 우회하도록 앱 스크립트 버전을 고정한다.
- [x] 기존 폰 service worker 캐시를 제거하는 fresh 진입점을 제공한다.

## Decisions
- 앱 설치 없이 HTTPS 정적 페이지로 실행 가능한 PWA로 구현한다.
- 카메라 QR 인식은 브라우저 `BarcodeDetector`를 우선 사용하고, 미지원 모바일 브라우저는 vendored `jsQR` canvas fallback을 사용한다.
- 이미지 복원은 `ISQ1` 포맷에서만 수행하고, 일반 QR은 텍스트만 표시한다.
- 모바일 브라우저의 `video.play()` Promise가 멈춰 보여도 스트림 확보 뒤 UI가 스캔 흐름으로 전환되도록 이벤트/타임아웃 기반 시작 대기를 사용한다.
