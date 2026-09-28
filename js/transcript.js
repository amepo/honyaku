/* Pure transcript logic — no DOM, no speech API — so it can be unit-tested in Node. */

/** 経過ミリ秒 → "mm:ss"（1時間以上は "h:mm:ss"） */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * SpeechRecognitionEvent の results を「確定」と「途中」に分ける。
 * results は SpeechRecognitionResultList 互換（length と [i][0].transcript, [i].isFinal）。
 */
export function splitResults(results, startIndex = 0) {
  const finals = [];
  let interim = '';
  for (let i = startIndex; i < results.length; i++) {
    const text = results[i][0].transcript.trim();
    if (!text) continue;
    if (results[i].isFinal) finals.push(text);
    else interim += (interim ? ' ' : '') + text;
  }
  return { finals, interim };
}

/** 文字起こしの行を持つストア。行は { at: 開始からのms, text } */
export class Transcript {
  constructor(lines = []) {
    this.lines = lines.filter(l => l && typeof l.text === 'string' && l.text.trim());
  }

  /**
   * 確定行を追加。Safari は同じ確定結果を二度送ってくることがあるので、
   * 直前と同じ文が短時間で来たら捨てる。追加したら true。
   */
  add(text, at, dedupeWindowMs = 3000) {
    const t = text.trim();
    if (!t) return false;
    const last = this.lines[this.lines.length - 1];
    if (last && last.text === t && at - last.at < dedupeWindowMs) return false;
    this.lines.push({ at, text: t });
    return true;
  }

  remove(index) {
    this.lines.splice(index, 1);
  }

  clear() {
    this.lines = [];
  }

  get isEmpty() {
    return this.lines.length === 0;
  }

  toText({ timestamps = false } = {}) {
    return this.lines
      .map(l => (timestamps ? `[${formatElapsed(l.at)}] ${l.text}` : l.text))
      .join('\n');
  }

  toJSON() {
    return this.lines;
  }

  static fromJSON(json) {
    try {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      return new Transcript(Array.isArray(data) ? data : []);
    } catch {
      return new Transcript();
    }
  }
}

/** 韓国語テキストを日本語に訳す Google 翻訳の URL */
export function translateUrl(text, target = 'ja') {
  const q = new URLSearchParams({ sl: 'ko', tl: target, text, op: 'translate' });
  return `https://translate.google.com/?${q}`;
}
