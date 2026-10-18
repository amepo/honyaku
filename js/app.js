import { formatElapsed, splitResults, Transcript, translateUrl } from './transcript.js';
import { builtinTranslator, googleTranslator, TranslationQueue } from './translate.js';
import { reading } from './reading.js';

const STORAGE_KEY = 'honyaku.transcript';
const PREFS_KEY = 'honyaku.prefs';
const FONT_SIZES = [16, 20, 26, 32];
const READING_MODES = ['kana', 'roman', 'off'];
const READING_LABELS = { kana: '読み:カナ', roman: '読み:ABC', off: '読み:—' };

const $ = id => document.getElementById(id);
const els = {
  lines: $('lines'), interim: $('interim'), interimYomi: $('interimYomi'), read: $('readBtn'), empty: $('empty'), unsupported: $('unsupported'),
  status: $('status'), timer: $('timer'), mic: $('micBtn'), copy: $('copyBtn'), save: $('saveBtn'),
  clear: $('clearBtn'), translateAll: $('translateAllBtn'), font: $('fontBtn'), ts: $('tsToggle'), tr: $('trToggle'), sourceSwitch: $('sourceSwitch'),
  toast: $('toast'), main: document.querySelector('main'),
};

// ---------- storage (best effort: private mode etc. may throw) ----------
const load = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* ignore */ } };

const transcript = Transcript.fromJSON(load(STORAGE_KEY, '[]'));
const DEFAULT_PREFS = { font: 1, ts: false, tr: true, source: 'mic', reading: 'kana' };
const prefs = (() => { try { return { ...DEFAULT_PREFS, ...JSON.parse(load(PREFS_KEY, '{}')) }; } catch { return { ...DEFAULT_PREFS }; } })();

// ---------- rendering ----------
const lineEls = new WeakMap(); // 行オブジェクト → <li>（翻訳が非同期で返ってきた時に更新するため）

function renderLine(line, index) {
  const li = document.createElement('li');
  li.className = 'line';
  li.dataset.index = index;
  li.innerHTML = `<time></time><div class="body"><p class="ko" lang="ko"></p><p class="yomi"></p><p class="ja" lang="ja"></p></div>
    <div class="line-actions">
    <button type="button" data-act="copy" title="この行をコピー">コピー</button>
    <button type="button" data-act="translate" title="この行を翻訳し直す">訳</button>
    <button type="button" data-act="delete" title="削除">✕</button></div>`;
  li.querySelector('time').textContent = formatElapsed(line.at);
  li.querySelector('.ko').textContent = line.text;
  li.querySelector('.yomi').textContent = reading(line.text, prefs.reading);
  lineEls.set(line, li);
  renderTranslation(line);
  return li;
}

/** 行の訳の表示を状態（訳あり / 翻訳中 / 失敗 / なし）に合わせる */
function renderTranslation(line) {
  const ja = lineEls.get(line)?.querySelector('.ja');
  if (!ja) return;
  ja.classList.remove('pending', 'error');
  if (line.ja) {
    ja.textContent = line.ja;
  } else if (translating.has(line)) {
    ja.textContent = '翻訳中…';
    ja.classList.add('pending');
  } else if (failed.has(line)) {
    ja.textContent = '翻訳できなかった（「訳」で再試行）';
    ja.classList.add('error');
  } else {
    ja.textContent = '';
  }
}

function appendLine() {
  const line = transcript.lines.at(-1);
  els.lines.append(renderLine(line, transcript.lines.length - 1));
  if (prefs.tr) requestTranslation(line);
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

function setInterim(text) {
  els.interim.textContent = text;
  els.interimYomi.textContent = reading(text, prefs.reading);
}

/** コピー・保存用のテキスト（画面に出しているものと同じ内容） */
function exportText() {
  return transcript.toText({
    timestamps: prefs.ts,
    translations: prefs.tr,
    reading: prefs.reading === 'off' ? null : text => reading(text, prefs.reading),
  });
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
  document.body.classList.toggle('show-tr', prefs.tr);
  document.body.classList.toggle('show-yomi', prefs.reading !== 'off');
  els.read.textContent = READING_LABELS[prefs.reading] ?? READING_LABELS.kana;
  els.ts.checked = prefs.ts;
  els.tr.checked = prefs.tr;
  store(PREFS_KEY, JSON.stringify(prefs));
}

// ---------- translation (韓国語 → 日本語) ----------
const translating = new Set(); // 翻訳待ち・翻訳中の行
const failed = new WeakSet();  // 失敗した行
let translatorPromise = null;
let engineAnnounced = false;

// 端末内の Translator API が使えればそれ、ダメなら Google。一度決めたら使い回す
function getTranslator() {
  translatorPromise ??= builtinTranslator().then(t => t ?? googleTranslator());
  return translatorPromise;
}

const queue = new TranslationQueue(getTranslator, {
  onDone(line, ja, engine) {
    translating.delete(line);
    failed.delete(line);
    if (!transcript.lines.includes(line)) return; // 翻訳中に消された
    line.ja = ja;
    persist();
    renderTranslation(line);
    if (!engineAnnounced) {
      engineAnnounced = true;
      toast(`翻訳エンジン: ${engine}`);
    }
  },
  onError(line) {
    translating.delete(line);
    failed.add(line);
    renderTranslation(line);
    if (!navigator.onLine) toast('オフラインなので翻訳できないよ');
  },
});

function requestTranslation(line, { force = false } = {}) {
  if ((line.ja && !force) || translating.has(line)) return;
  if (force) delete line.ja;
  translating.add(line);
  failed.delete(line);
  renderTranslation(line);
  queue.push(line);
}

function translateMissing() {
  for (const line of transcript.lines) if (!line.ja) requestTranslation(line);
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
let audioTrack = null;       // 「配信・タブの音声」モードで共有してもらった音声トラック

// Chrome 139 前後から start(MediaStreamTrack) でマイク以外の音声を認識できる。
// 対応していれば MediaStreamTrack 以外を渡すと TypeError になる（その場合は何も始まらない）
let trackInputSupported;
function supportsTrackInput() {
  if (trackInputSupported !== undefined) return trackInputSupported;
  const probe = new SR();
  try {
    probe.start(0);
    probe.abort(); // 引数を無視して始まってしまった = 非対応
    trackInputSupported = false;
  } catch (e) {
    trackInputSupported = e instanceof TypeError;
  }
  return trackInputSupported;
}

// PC の Chrome / Edge で画面共有が使えるときだけ入力元の切替を出す
const canCaptureTab = !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

/** タブ（配信ページ）の音声を共有してもらう。取れなかったら null */
async function captureTabAudio() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, // Chrome は video なしだと共有ダイアログを出せない
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      windowAudio: 'window', // 対応ブラウザでは選択したアプリウィンドウの音声を共有できる
      selfBrowserSurface: 'exclude',
      preferCurrentTab: false,
    });
  } catch {
    return null; // キャンセル
  }
  stream.getVideoTracks().forEach(t => t.stop()); // 映像は要らない
  const track = stream.getAudioTracks()[0];
  if (!track) {
    toast('音声を共有できなかったよ。Discord のタブを選ぶか、Mac では Chrome の画面収録とシステムオーディオを許可してね');
    return null;
  }
  track.addEventListener('ended', () => {
    if (!wanted) return;
    stop();
    toast('共有が終わったので停止したよ');
  });
  return track;
}

function startRecognition() {
  if (prefs.source === 'tab' && audioTrack) recognition.start(audioTrack);
  else recognition.start();
}

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
        appendLine();
        added = true;
      }
    }
    setInterim(interim);
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
      appendLine();
      persist();
    }
    setInterim('');
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
      try { startRecognition(); } catch { /* already started */ }
    }, 250);
  };

  return rec;
}

async function start() {
  if (!SR || wanted) return;
  if (prefs.source === 'tab') {
    if (!supportsTrackInput()) {
      toast('このブラウザはタブ音声の認識に未対応。最新の Chrome / Edge で開いてね');
      return;
    }
    audioTrack = await captureTabAudio();
    if (!audioTrack) return;
  }
  wanted = true;
  recognition ??= createRecognition();
  sessionStart = Date.now();
  restartTimes = [];
  try {
    startRecognition();
  } catch {
    /* already started */
  }
  els.sourceSwitch.classList.add('locked');
  for (const r of els.sourceSwitch.querySelectorAll('input')) r.disabled = true;
  els.mic.setAttribute('aria-pressed', 'true');
  els.mic.setAttribute('aria-label', '録音停止');
  setStatus(prefs.source === 'tab' ? '音声準備中…' : 'マイク準備中…', true);
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
  audioTrack?.stop(); // 共有も終わらせる（ブラウザ上部の「共有中」バーが消える）
  audioTrack = null;
  els.sourceSwitch.classList.remove('locked');
  for (const r of els.sourceSwitch.querySelectorAll('input')) r.disabled = false;
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
  const text = exportText();
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const blob = new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `korean-${stamp}.txt` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

els.mic.addEventListener('click', () => (wanted ? stop() : start()));
els.copy.addEventListener('click', () => copyText(exportText()));
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
els.read.addEventListener('click', () => {
  prefs.reading = READING_MODES[(READING_MODES.indexOf(prefs.reading) + 1) % READING_MODES.length];
  applyPrefs();
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
els.tr.addEventListener('change', () => {
  prefs.tr = els.tr.checked;
  applyPrefs();
  if (prefs.tr) translateMissing(); // オンにした瞬間（ユーザー操作中）に端末内モデルの準備もできる
});
els.lines.addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const index = Number(btn.closest('.line').dataset.index);
  const line = transcript.lines[index];
  if (!line) return;
  if (btn.dataset.act === 'copy') copyText(new Transcript([line]).toText({ translations: prefs.tr, reading: prefs.reading === 'off' ? null : t => reading(t, prefs.reading) }));
  if (btn.dataset.act === 'translate') {
    if (!prefs.tr) {
      prefs.tr = true;
      applyPrefs();
    }
    requestTranslation(line, { force: true });
  }
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

function applySource() {
  const tab = prefs.source === 'tab';
  els.empty.innerHTML = tab
    ? 'Discord のボイスチャットを開いて、下のボタンを押して<br>共有元に Discord の音声を選んでね 🖥️<br><small>タブ音声、対応する Mac / Windows では共有ウィンドウの音声も選べるよ</small>'
    : '下のマイクを押して韓国語を話してね 🎙️<br><span lang="ko">마이크를 누르고 말해 보세요</span>';
  els.mic.setAttribute('aria-label', tab ? 'タブ音声の文字起こしを開始' : '録音開始');
}
els.sourceSwitch.addEventListener('change', e => {
  prefs.source = e.target.value;
  applyPrefs();
  applySource();
});

// ---------- boot ----------
if (!SR) {
  els.unsupported.hidden = false;
  els.mic.disabled = true;
}
if (canCaptureTab && SR) {
  els.sourceSwitch.hidden = false;
} else {
  prefs.source = 'mic';
}
els.sourceSwitch.querySelector(`input[value="${prefs.source}"]`).checked = true;
applySource();
if (transcript.lines.length) elapsedBefore = transcript.lines.at(-1).at + 1000;
els.timer.textContent = formatElapsed(elapsedBefore);
applyPrefs();
renderAll();
scrollToBottom();
if (prefs.tr) translateMissing();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
