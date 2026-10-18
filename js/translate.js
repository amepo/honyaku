/* 韓国語 → 日本語の翻訳。DOM 非依存（fetch や Translator は注入できる）なので Node でテストできる。

   エンジンの優先順:
   1. ブラウザ内蔵の Translator API（Chrome デスクトップ等。端末内で処理・オフライン可）
   2. Google 翻訳の無料エンドポイント（translate.googleapis.com, client=gtx）
      ※ 公式の API ではないので、仕様変更や回数制限で使えなくなる可能性がある */

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';

/** promise が ms 以内に終わらなければ reject（Translator API は環境次第で返ってこないことがある） */
export function withTimeout(promise, ms, label = 'timeout') {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/** gtx レスポンス [[["訳","原文",...], ...], ...] から訳文を連結して取り出す */
export function parseGoogleResponse(data) {
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('unexpected response');
  const text = data[0].map(seg => (Array.isArray(seg) && typeof seg[0] === 'string' ? seg[0] : '')).join('');
  if (!text.trim()) throw new Error('empty translation');
  return text.trim();
}

export function googleTranslator({ source = 'ko', target = 'ja', fetchImpl = globalThis.fetch } = {}) {
  return {
    name: 'Google',
    async translate(text) {
      const q = new URLSearchParams({ client: 'gtx', sl: source, tl: target, dt: 't', q: text });
      const res = await withTimeout(fetchImpl(`${GOOGLE_ENDPOINT}?${q}`), 10_000, 'translate timeout');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseGoogleResponse(await res.json());
    },
  };
}

/**
 * ブラウザ内蔵 Translator API で ko→ja がすぐ使えるならそれを返す。使えなければ null。
 * モデルのダウンロード待ち（'downloadable' / 'downloading'）は時間が読めないので使わない。
 */
export async function builtinTranslator({ source = 'ko', target = 'ja', api = globalThis.Translator, timeoutMs = 3000 } = {}) {
  if (!api?.availability || !api?.create) return null;
  try {
    const langs = { sourceLanguage: source, targetLanguage: target };
    const availability = await withTimeout(api.availability(langs), timeoutMs);
    if (availability !== 'available') return null;
    const t = await withTimeout(api.create(langs), timeoutMs);
    return { name: '端末内', translate: text => withTimeout(t.translate(text), 10_000, 'translate timeout') };
  } catch {
    return null;
  }
}

/**
 * 翻訳ジョブを少数並列で処理するキュー。
 * 1件ずつの直列待ちで会話中に翻訳が滞留しないようにする。
 * 同じ行（オブジェクト）は二重に積まず、結果は onDone / onError で返す。
 */
export class TranslationQueue {
  constructor(getTranslator, { onDone, onError, concurrency = 2 } = {}) {
    this.getTranslator = getTranslator;
    this.onDone = onDone ?? (() => {});
    this.onError = onError ?? (() => {});
    this.concurrency = Math.max(1, Math.floor(concurrency) || 1);
    this.pending = [];
    this.queued = new Set();
    this.running = null;
  }

  push(item) {
    if (this.queued.has(item)) return;
    this.queued.add(item);
    this.pending.push(item);
    this.#schedule();
  }

  #schedule() {
    if (this.running) return;
    this.running = this.#drain().finally(() => {
      this.running = null;
      // push と drain 完了が重なった場合も、残りを取りこぼさない
      if (this.pending.length) this.#schedule();
    });
  }

  /** 積まれている分が全部終わるまで待つ（テスト用） */
  idle() {
    return this.running ?? Promise.resolve();
  }

  async #drain() {
    const worker = async () => {
      while (this.pending.length) {
        const item = this.pending.shift();
        try {
          const translator = await this.getTranslator();
          const ja = await translator.translate(item.text);
          this.onDone(item, ja, translator.name);
        } catch (err) {
          this.onError(item, err);
        } finally {
          this.queued.delete(item);
        }
      }
    };
    await Promise.all(Array.from({ length: this.concurrency }, worker));
  }
}


const translatorCache = new Map();

/** 指定された方法で翻訳器を返す。端末内翻訳はブラウザが対応しモデルを利用できる場合のみ使える。 */
export function papagoTranslator({ endpoint, token, source, target, fetchImpl = globalThis.fetch } = {}) {
  return {
    name: 'Papago',
    async translate(text) {
      if (!endpoint || !token) throw new Error('Papago Worker のURLとトークンを設定してください');
      let url;
      try {
        url = new URL(endpoint);
      } catch {
        throw new Error('Papago Worker のURLを確認してください');
      }
      if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
        throw new Error('Papago Worker のURLは HTTPS が必要です');
      }
      const base = endpoint.replace(/\\/+$/, '');
      const apiUrl = base.endsWith('/translate') ? base : `${base}/translate`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetchImpl(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ source, target, text }),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Papago Worker error (HTTP ${response.status})`);
        if (typeof data.translatedText !== 'string' || !data.translatedText.trim()) {
          throw new Error('Papago から翻訳結果が返りませんでした');
        }
        return data.translatedText.trim();
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('Papago の応答がタイムアウトしました');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function resolveTranslator(source, target, provider = 'auto', papago = {}) {
  // 認証トークンを translatorCache のキーに含めないよう、Papago はキャッシュしない
  if (provider === 'papago') return papagoTranslator({ ...papago, source, target });
  const key = `${source}:${target}:${provider}`;
  if (!translatorCache.has(key)) {
    const promise = (async () => {
      if (provider === 'google') return googleTranslator({ source, target });
      const local = await builtinTranslator({ source, target });
      if (provider === 'device') {
        if (!local) throw new Error('このブラウザでは端末内翻訳を利用できません');
        return local;
      }
      return local ?? googleTranslator({ source, target });
    })();
    translatorCache.set(key, promise);
  }
  return translatorCache.get(key);
}
