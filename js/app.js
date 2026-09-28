import { formatElapsed, splitResults, Transcript, translateUrl } from './transcript.js';

const STORAGE_KEY = 'honyaku.transcript';
const PREFS_KEY = 'honyaku.prefs';
const FONT_SIZES = [16, 20, 26, 32];

const $ = id => document.getElementById(id);
const els = {
  lines: $('lines'), interim: $('interim'), empty: $('empty'), unsupported: $('unsupported'),
  status: $('status'), timer: $('timer'), mic: $('micBtn'), copy: $('copyBtn'), save: $('saveBtn'),
  clear: $('clearBtn'), translateAll: $('translateAllBtn'), font: $('fontBtn'), ts: $('tsToggle'),
  toast: $('toast'), main: document.querySelector('main'),
};

// ---------- storage (best effort: private mode etc. may throw) ----------
const load = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };

const transcript = Transcript.fromJSON(load(STORAGE_KEY, '[]'));
const prefs = (() => { try { return { font: 1, ts: false, ...JSON.parse(load(PREFS_KEY, '{}')) }; } catch { return { font: 1, ts: false }; } })();

// ---------- rendering ----------
function renderLine(line, index) {
  const li = document.createElement('li');
  li.className = 'line';
  li.dataset.index = index;
  li.innerHTML = `<time></time><p lang="ko"></p><div class="line-actions">
    <button type="button" data-act="copy" title="この行をコピー">コピー</button>
    <button type="button" data-act="translate" title="翻訳">訳</button>
    <button type="button" data-act="delete" title="削除">✕</button></div>`;
  li.querySelector('time').textContent = formatElapsed(line.at);
  li.querySelector('p').textContent = line.text;
  return li;
}

function renderAll() {
  els.lines.replaceChildren(...transcript.lines.map(renderLine));
  syncUi();
}

function syncUi() {
  const empty = transcript.isEmpty;
  els.empty.hidden = !empty || !!els.interim.textContent || !SR;
  for (const b of [els.copy, els.save, els.clear, els.translateAll]) b.disabled = empty;
}

function persist() {
  store(STORAGE_KEY, JSON.stringify(transcript));
}

function scrollToBottom() {
  els.main.scrollTop = els.main.scrollHeight;
}

let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2200);
}

function applyPrefs() {
  document.documentElement.style.setProperty('--font-size', `${FONT_SIZES[prefs.font] ?? 20}px`);
  document.body.classList.toggle('show-ts', prefs.ts);
  els.ts.checked = prefs.ts;
  store(PREFS_KEY, JSON.stringify(prefs));
}

// ---------- speech recognition ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition = null;
let wanted = false;          // ユーザーが録音中にしたいか（ブラウザが勝手に止めたら再開する）
let sessionStart = 0;        // タイムスタンプの基準
let elapsedBefore = 0;       // 一時停止前までの経過
let timerId = null;
let wakeLock = null;
let restartTimes = [];

function elapsed() {
  return elapsedBefore + (sessionStart ? Date.now() - sessionStart : 0);
}

function setStatus(text, on = false) {
  els.status.textContent = text;
  els.status.classList.toggle('on', on);
}

function createRecognition() {
  const rec = new SR();
  rec.lang = 'ko-KR';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onstart = () => setStatus('● 聞き取り中', true);

  rec.onresult = event => {
    const { finals, interim } = splitResults(event.results, event.resultIndex);
    let added = false;
    for (const text of finals) {
      if (transcript.add(text, elapsed())) {
        els.lines.append(renderLine(transcript.lines.at(-1), transcript.lines.length - 1));
        added = true;
      }
    }
    els.interim.textContent = interim;
    if (added) persist();
    syncUi();
    scrollToBottom();
  };

  rec.onerror = event => {
    switch (event.error) {
      case 'no-speech':
      case 'aborted':
        return; // 無音で切れただけ。onend で再開する
      case 'not-allowed':
      case 'service-not-allowed':
        stop();
        toast('マイクの許可がないよ。ブラウザの設定で許可してね');
        return;
      case 'audio-capture':
        stop();
        toast('マイクが見つからないよ');
        return;
      case 'network':
        toast('ネットワークエラー。音声認識にはネット接続が必要だよ');
        return;
      default:
        toast(`エラー: ${event.error}`);
    }
  };

  rec.onend = () => {
    // 確定しないまま切れた途中結果は捨てずに残す
    const pending = els.interim.textContent.trim();
    if (pending && transcript.add(pending, elapsed())) {
      els.lines.append(renderLine(transcript.lines.at(-1), transcript.lines.length - 1));
      persist();
    }
    els.interim.textContent = '';
    syncUi();

    if (!wanted) return;
    // ブラウザは無音や一定時間で勝手に止める → 自動で再開。ただし暴走（連続失敗）は止める
    const now = Date.now();
    restartTimes = restartTimes.filter(t => now - t < 10_000);
    restartTimes.push(now);
    if (restartTimes.length > 8) {
      stop();
      toast('音声認識が何度も止まったので停止したよ');
      return;
    }
    setStatus('再接続中…', true);
    setTimeout(() => {
      if (!wanted) return;
      try { recognition.start(); } catch { /* already started */ }
    }, 250);
  };

  return rec;
}

async function start() {
  if (!SR || wanted) return;
  wanted = true;
  recognition ??= createRecognition();
  sessionStart = Date.now();
  restartTimes = [];
  try {
    recognition.start();
  } catch {
    /* already started */
  }
  els.mic.setAttribute('aria-pressed', 'true');
  els.mic.setAttribute('aria-label', '録音停止');
  setStatus('マイク準備中…', true);
  timerId = setInterval(() => { els.timer.textContent = formatElapsed(elapsed()); }, 500);
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
  syncUi();
}

function stop() {
  if (!wanted) return;
  wanted = false;
  elapsedBefore = elapsed();
  sessionStart = 0;
  try { recognition?.stop(); } catch { /* ignore */ }
  clearInterval(timerId);
  els.mic.setAttribute('aria-pressed', 'false');
  els.mic.setAttribute('aria-label', '録音開始');
  setStatus('停止中');
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// ---------- actions ----------
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしたよ');
  } catch {
    // 古い Safari 等のフォールバック
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('コピーしたよ');
  }
}

function saveFile() {
  const text = transcript.toText({ timestamps: prefs.ts });
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `korean-${stamp}.txt` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

els.mic.addEventListener('click', () => (wanted ? stop() : start()));
els.copy.addEventListener('click', () => copyText(transcript.toText({ timestamps: prefs.ts })));
els.save.addEventListener('click', saveFile);
els.translateAll.addEventListener('click', () => window.open(translateUrl(transcript.toText()), '_blank', 'noopener'));
els.clear.addEventListener('click', () => {
  if (!confirm('文字起こしを全部消す？')) return;
  transcript.clear();
  elapsedBefore = 0;
  if (wanted) sessionStart = Date.now();
  els.timer.textContent = '00:00';
  persist();
  renderAll();
});
els.font.addEventListener('click', () => {
  prefs.font = (prefs.font + 1) % FONT_SIZES.length;
  applyPrefs();
});
els.ts.addEventListener('change', () => {
  prefs.ts = els.ts.checked;
  applyPrefs();
});
els.lines.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const index = Number(btn.closest('.line').dataset.index);
  const line = transcript.lines[index];
  if (!line) return;
  if (btn.dataset.act === 'copy') copyText(line.text);
  if (btn.dataset.act === 'translate') window.open(translateUrl(line.text), '_blank', 'noopener');
  if (btn.dataset.act === 'delete') {
    transcript.remove(index);
    persist();
    renderAll();
  }
});
// 画面を戻したら Wake Lock を取り直す（タブ切替で自動解除されるため）
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wanted && (!wakeLock || wakeLock.released)) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  }
});

// ---------- boot ----------
if (!SR) {
  els.unsupported.hidden = false;
  els.mic.disabled = true;
}
if (transcript.lines.length) elapsedBefore = transcript.lines.at(-1).at + 1000;
els.timer.textContent = formatElapsed(elapsedBefore);
applyPrefs();
renderAll();
scrollToBottom();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
