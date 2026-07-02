/**
 * Drive Markdown Viewer
 * 구글 드라이브의 .md 파일을 실시간으로 열람하는 순수 클라이언트 사이드 앱.
 * - Google Identity Services(GIS)로 OAuth 토큰 발급
 * - Drive REST API v3로 파일 목록/내용 조회
 * - 열어둔 파일의 modifiedTime을 폴링해서 변경 시 자동 재렌더링
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const CLIENT_ID_KEY = 'gdmv_client_id';
const THEME_KEY = 'gdmv_theme';
const FILE_POLL_MS = 5000;   // 열어둔 파일 변경 감지 주기
const LIST_POLL_MS = 30000;  // 파일 목록 갱신 주기

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let gisLoaded = false;

let allFiles = [];
let currentFile = null;   // { id, name, modifiedTime, webViewLink }
let filePollTimer = null;
let listPollTimer = null;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const screens = {
  setup: $('setup-screen'),
  login: $('login-screen'),
  app: $('app-screen'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
}

function toast(msg, ms = 2500) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.add('hidden'), ms);
}

// ---------- 초기화 ----------
function onGisLoaded() {
  gisLoaded = true;
  init();
}
window.onGisLoaded = onGisLoaded;

function init() {
  const clientId = localStorage.getItem(CLIENT_ID_KEY);
  if (!clientId) {
    showScreen('setup');
    return;
  }
  showScreen('login');
  if (gisLoaded && !tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: onToken,
      error_callback: (err) => {
        console.error(err);
        toast('로그인에 실패했습니다: ' + (err.type || err.message || '알 수 없는 오류'));
        showScreen('login');
      },
    });
  }
}

function onToken(resp) {
  if (resp.error) {
    toast('토큰 발급 실패: ' + resp.error);
    showScreen('login');
    return;
  }
  accessToken = resp.access_token;
  tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
  showScreen('app');
  loadFileList();
  startListPolling();
}

/** 토큰이 만료됐으면 조용히 재발급 시도 */
async function ensureToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return;
  await new Promise((resolve) => {
    const prev = tokenClient.callback;
    tokenClient.callback = (resp) => {
      tokenClient.callback = prev;
      if (!resp.error) {
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
      }
      resolve();
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// ---------- Drive API ----------
async function driveFetch(url, opts = {}) {
  await ensureToken();
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: 'Bearer ' + accessToken, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    // 토큰 무효화 → 강제 재발급 후 1회 재시도
    accessToken = null;
    await ensureToken();
    return fetch(url, {
      ...opts,
      headers: { Authorization: 'Bearer ' + accessToken, ...(opts.headers || {}) },
    });
  }
  return res;
}

async function fetchMarkdownFiles() {
  const q = encodeURIComponent(
    "trashed=false and (mimeType='text/markdown' or mimeType='text/x-markdown' or name contains '.md')"
  );
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink)');
  let files = [];
  let pageToken = '';
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&orderBy=modifiedTime%20desc&pageSize=100${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await driveFetch(url);
    if (!res.ok) throw new Error('파일 목록 조회 실패 (' + res.status + ')');
    const data = await res.json();
    files = files.concat(data.files || []);
    pageToken = data.nextPageToken || '';
  } while (pageToken && files.length < 500);

  // 구글 문서 등 네이티브 형식 제외, 확장자가 .md/.markdown인 것만
  return files.filter(
    (f) =>
      !f.mimeType.startsWith('application/vnd.google-apps') &&
      /\.(md|markdown)$/i.test(f.name)
  );
}

async function fetchFileContent(id) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  if (!res.ok) throw new Error('파일 내용 조회 실패 (' + res.status + ')');
  return res.text();
}

async function fetchFileMeta(id) {
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,modifiedTime,webViewLink`
  );
  if (!res.ok) throw new Error('파일 메타데이터 조회 실패 (' + res.status + ')');
  return res.json();
}

// ---------- 파일 목록 ----------
async function loadFileList() {
  const listEl = $('file-list');
  try {
    allFiles = await fetchMarkdownFiles();
    renderFileList();
  } catch (e) {
    console.error(e);
    listEl.innerHTML = '<div class="list-status">목록을 불러오지 못했습니다.<br>' + e.message + '</div>';
  }
}

function renderFileList() {
  const listEl = $('file-list');
  const query = $('search-input').value.trim().toLowerCase();
  const files = query ? allFiles.filter((f) => f.name.toLowerCase().includes(query)) : allFiles;

  if (files.length === 0) {
    listEl.innerHTML = '<div class="list-status">' +
      (query ? '검색 결과가 없습니다.' : '드라이브에 .md 파일이 없습니다.') + '</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const f of files) {
    const item = document.createElement('button');
    item.className = 'file-item' + (currentFile && currentFile.id === f.id ? ' active' : '');
    item.innerHTML =
      `<span class="file-name">${escapeHtml(f.name)}</span>` +
      `<span class="file-meta">${formatDate(f.modifiedTime)}</span>`;
    item.addEventListener('click', () => openFile(f));
    listEl.appendChild(item);
  }
}

// ---------- 파일 열기 & 실시간 연동 ----------
async function openFile(file) {
  currentFile = { ...file };
  renderFileList();
  $('viewer-empty').classList.add('hidden');
  $('viewer-toolbar').classList.remove('hidden');
  $('markdown-body').classList.remove('hidden');
  $('current-file-name').textContent = file.name;
  $('open-in-drive').href = file.webViewLink || '#';
  setSyncStatus('loading');

  try {
    const text = await fetchFileContent(file.id);
    renderMarkdown(text);
    setSyncStatus('live');
    updateTimestamp(file.modifiedTime);
  } catch (e) {
    console.error(e);
    $('markdown-body').innerHTML = '<p class="error">파일을 불러오지 못했습니다: ' + escapeHtml(e.message) + '</p>';
    setSyncStatus('error');
  }
  startFilePolling();
}

function startFilePolling() {
  clearInterval(filePollTimer);
  filePollTimer = setInterval(async () => {
    if (!currentFile || document.hidden) return;
    try {
      const meta = await fetchFileMeta(currentFile.id);
      if (meta.modifiedTime !== currentFile.modifiedTime) {
        currentFile.modifiedTime = meta.modifiedTime;
        const text = await fetchFileContent(currentFile.id);
        renderMarkdown(text);
        updateTimestamp(meta.modifiedTime);
        setSyncStatus('live');
        toast('📄 드라이브의 변경 사항을 반영했습니다');
      }
    } catch (e) {
      console.warn('폴링 실패:', e);
      setSyncStatus('error');
    }
  }, FILE_POLL_MS);
}

function startListPolling() {
  clearInterval(listPollTimer);
  listPollTimer = setInterval(() => {
    if (!document.hidden) loadFileList();
  }, LIST_POLL_MS);
}

function setSyncStatus(state) {
  const el = $('sync-status');
  el.className = 'sync-badge';
  if (state === 'live') {
    el.classList.add('sync-live');
    el.textContent = '● 실시간 연동 중';
  } else if (state === 'loading') {
    el.classList.add('sync-loading');
    el.textContent = '○ 불러오는 중…';
  } else {
    el.classList.add('sync-error');
    el.textContent = '● 연결 오류';
  }
}

function updateTimestamp(iso) {
  $('last-updated').textContent = '수정: ' + formatDate(iso);
}

// ---------- 마크다운 렌더링 ----------
function renderMarkdown(text) {
  marked.setOptions({ gfm: true, breaks: false });
  const rawHtml = marked.parse(text);
  const safeHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] });
  const body = $('markdown-body');
  body.innerHTML = safeHtml;

  // 외부 링크는 새 탭에서
  body.querySelectorAll('a[href^="http"]').forEach((a) => {
    a.target = '_blank';
    a.rel = 'noopener';
  });
  // 코드 하이라이팅
  body.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
}

// ---------- 유틸 ----------
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 60000) return '방금 전';
  if (diffMs < 3600000) return Math.floor(diffMs / 60000) + '분 전';
  if (diffMs < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------- 테마 ----------
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('hljs-theme-light').disabled = theme === 'dark';
  $('hljs-theme-dark').disabled = theme !== 'dark';
  localStorage.setItem(THEME_KEY, theme);
}

// ---------- 이벤트 바인딩 ----------
$('save-client-id').addEventListener('click', () => {
  const v = $('client-id-input').value.trim();
  if (!v.endsWith('.apps.googleusercontent.com')) {
    toast('올바른 클라이언트 ID 형식이 아닙니다.');
    return;
  }
  localStorage.setItem(CLIENT_ID_KEY, v);
  tokenClient = null; // 새 클라이언트 ID로 재생성
  init();
});

$('change-client-id').addEventListener('click', () => {
  $('client-id-input').value = localStorage.getItem(CLIENT_ID_KEY) || '';
  showScreen('setup');
});

$('sign-in').addEventListener('click', () => {
  if (!tokenClient) {
    if (gisLoaded) init();
    if (!tokenClient) {
      toast('Google 로그인 스크립트를 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }
  }
  tokenClient.requestAccessToken({ prompt: '' });
});

$('sign-out').addEventListener('click', () => {
  if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
  accessToken = null;
  currentFile = null;
  clearInterval(filePollTimer);
  clearInterval(listPollTimer);
  showScreen('login');
});

$('refresh-list').addEventListener('click', () => {
  $('file-list').innerHTML = '<div class="list-status">불러오는 중…</div>';
  loadFileList();
});

$('search-input').addEventListener('input', renderFileList);

$('toggle-theme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
});

// 초기 테마
applyTheme(
  localStorage.getItem(THEME_KEY) ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
);

// GIS가 먼저 로드된 경우 대비
if (window.google && google.accounts) onGisLoaded();
else if (!localStorage.getItem(CLIENT_ID_KEY)) showScreen('setup');
