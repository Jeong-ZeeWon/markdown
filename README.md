# 🗂️ Drive Markdown Viewer

구글 드라이브에 있는 마크다운(`.md`) 파일을 **실시간으로** 열어보는 웹 앱입니다.

- 드라이브의 모든 `.md` / `.markdown` 파일을 자동으로 찾아 목록으로 보여줍니다
- GitHub 스타일 마크다운 렌더링 (코드 하이라이팅, 표, 체크박스 지원)
- **실시간 연동**: 드라이브에서 파일이 수정되면 5초 안에 자동으로 화면에 반영됩니다
- 파일 이름 검색, 다크 모드, 모바일 대응
- 서버 없음 — 순수 정적 웹앱이라 GitHub Pages에 바로 배포 가능합니다
- 읽기 전용 권한(`drive.readonly`)만 사용하며, 파일 내용은 브라우저 밖으로 나가지 않습니다

## 설정 방법

앱을 사용하려면 Google Cloud OAuth **클라이언트 ID**가 한 번만 필요합니다 (무료, 약 5분 소요).

### 1. Google Cloud 프로젝트 만들기

1. [Google Cloud Console](https://console.cloud.google.com/)에 접속해서 새 프로젝트를 만듭니다 (예: `drive-md-viewer`)
2. **API 및 서비스 → 라이브러리**에서 **Google Drive API**를 검색해서 **사용 설정**합니다

### 2. OAuth 동의 화면 설정

1. **API 및 서비스 → OAuth 동의 화면**으로 이동합니다
2. User Type은 **외부(External)** 를 선택하고, 앱 이름과 이메일을 입력합니다
3. **테스트 사용자**에 본인 구글 계정 이메일을 추가합니다
   - 개인용이라면 앱을 "테스트" 상태로 두면 됩니다 (별도 심사 불필요)

### 3. OAuth 클라이언트 ID 만들기

1. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
2. 애플리케이션 유형: **웹 애플리케이션**
3. **승인된 JavaScript 원본**에 앱을 띄울 주소를 추가합니다:
   - 로컬 테스트: `http://localhost:8000`
   - GitHub Pages 배포 시: `https://<깃허브아이디>.github.io`
4. 생성된 **클라이언트 ID** (`xxxx.apps.googleusercontent.com` 형식)를 복사합니다

### 4. 앱 실행

앱을 처음 열면 클라이언트 ID 입력 화면이 나옵니다. 복사한 ID를 붙여넣으면 끝입니다.
(브라우저 localStorage에 저장되므로 한 번만 입력하면 됩니다)

## 실행 방법

### 로컬에서 실행

```bash
# 저장소 클론 후
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

### GitHub Pages로 배포

1. 저장소 **Settings → Pages**에서 Source를 `main` 브랜치(root)로 설정
2. `https://<깃허브아이디>.github.io/markdown/` 접속
3. OAuth 클라이언트의 "승인된 JavaScript 원본"에 `https://<깃허브아이디>.github.io`를 추가했는지 확인

## 실시간 연동 동작 방식

- 파일을 열면 5초마다 드라이브 API로 해당 파일의 `modifiedTime`을 확인합니다
- 수정 시각이 바뀌면 파일 내용을 다시 받아와 즉시 재렌더링합니다
- 파일 목록도 30초마다 자동 갱신됩니다
- 탭이 백그라운드에 있을 때는 폴링을 멈춰서 불필요한 API 호출을 줄입니다

## 기술 스택

| 역할 | 사용 기술 |
|---|---|
| 인증 | Google Identity Services (OAuth 2.0 토큰) |
| 파일 조회 | Google Drive REST API v3 |
| 마크다운 렌더링 | [marked](https://github.com/markedjs/marked) |
| XSS 방지 | [DOMPurify](https://github.com/cure53/DOMPurify) |
| 코드 하이라이팅 | [highlight.js](https://highlightjs.org/) |

빌드 도구나 서버 없이 `index.html` + `app.js` + `styles.css` 세 파일로 동작합니다.
