import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGoogleResponse, googleTranslator, builtinTranslator, TranslationQueue, withTimeout } from '../js/translate.js';

test('parseGoogleResponse joins sentence segments', () => {
  const data = [[['今日は天気が良いですね。', '오늘 날씨가 좋네요.'], ['散歩に行きましょう。', '산책 가요.'], [null, null, 'romanization']], null, 'ko'];
  assert.equal(parseGoogleResponse(data), '今日は天気が良いですね。散歩に行きましょう。');
});

test('parseGoogleResponse rejects junk', () => {
  assert.throws(() => parseGoogleResponse({}));
  assert.throws(() => parseGoogleResponse([[]]));
});

test('googleTranslator builds the request and parses the reply', async () => {
  let called;
  const fetchImpl = async url => {
    called = new URL(url);
    return { ok: true, json: async () => [[['こんにちは', '안녕하세요']]] };
  };
  const t = googleTranslator({ fetchImpl });
  assert.equal(await t.translate('안녕하세요'), 'こんにちは');
  assert.equal(called.hostname, 'translate.googleapis.com');
  assert.equal(called.searchParams.get('sl'), 'ko');
  assert.equal(called.searchParams.get('tl'), 'ja');
  assert.equal(called.searchParams.get('q'), '안녕하세요');
});

test('googleTranslator surfaces HTTP errors', async () => {
  const t = googleTranslator({ fetchImpl: async () => ({ ok: false, status: 429 }) });
  await assert.rejects(t.translate('네'), /429/);
});

test('builtinTranslator: missing / unavailable / available', async () => {
  assert.equal(await builtinTranslator({ api: undefined }), null);
  const unavailable = { availability: async () => 'unavailable', create: async () => assert.fail() };
  assert.equal(await builtinTranslator({ api: unavailable }), null);
  const api = { availability: async () => 'available', create: async () => ({ translate: async s => `[${s}]` }) };
  const t = await builtinTranslator({ api });
  assert.equal(t.name, '端末内');
  assert.equal(await t.translate('네'), '[네]');
  const downloadable = { availability: async () => 'downloadable', create: async () => assert.fail() };
  assert.equal(await builtinTranslator({ api: downloadable }), null);
  const throwing = { availability: async () => 'available', create: async () => { throw new Error('nope'); } };
  assert.equal(await builtinTranslator({ api: throwing }), null);
  const hanging = { availability: () => new Promise(() => {}), create: async () => assert.fail() };
  assert.equal(await builtinTranslator({ api: hanging, timeoutMs: 20 }), null);
});

test('withTimeout', async () => {
  assert.equal(await withTimeout(Promise.resolve(1), 50), 1);
  await assert.rejects(withTimeout(new Promise(() => {}), 10, 'slow'), /slow/);
});

test('TranslationQueue runs sequentially, dedupes, and reports errors', async () => {
  let active = 0;
  let maxActive = 0;
  const translator = {
    name: 'fake',
    async translate(text) {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      if (text === 'bad') throw new Error('boom');
      return text.toUpperCase();
    },
  };
  const done = [];
  const failed = [];
  const q = new TranslationQueue(async () => translator, {
    onDone: (item, ja) => done.push([item.text, ja]),
    onError: item => failed.push(item.text),
  });
  const a = { text: 'a' };
  q.push(a);
  q.push(a);
  q.push({ text: 'bad' });
  q.push({ text: 'c' });
  await q.idle();
  assert.deepEqual(done, [['a', 'A'], ['c', 'C']]);
  assert.deepEqual(failed, ['bad']);
  assert.equal(maxActive, 1);
  // can be re-queued after finishing (retry)
  q.push(a);
  await q.idle();
  assert.equal(done.length, 3);
});
