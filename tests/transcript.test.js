import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsed, splitResults, Transcript, translateUrl } from '../js/transcript.js';

const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });

test('formatElapsed', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(65_400), '01:05');
  assert.equal(formatElapsed(3_723_000), '1:02:03');
  assert.equal(formatElapsed(-5), '00:00');
});

test('splitResults separates final and interim from resultIndex', () => {
  const results = [result('이미 처리됨', true), result('안녕하세요 ', true), result('반갑', false), result('습니다', false)];
  assert.deepEqual(splitResults(results, 1), { finals: ['안녕하세요'], interim: '반갑 습니다' });
});

test('splitResults ignores blank results', () => {
  assert.deepEqual(splitResults([result('  ', true), result('', false)]), { finals: [], interim: '' });
});

test('Transcript.add dedupes an immediate repeat but keeps later ones', () => {
  const t = new Transcript();
  assert.equal(t.add('감사합니다', 1000), true);
  assert.equal(t.add('감사합니다', 1500), false);
  assert.equal(t.add('감사합니다', 9000), true);
  assert.equal(t.add('   ', 9500), false);
  assert.equal(t.lines.length, 2);
});

test('Transcript text export and JSON round-trip', () => {
  const t = new Transcript();
  t.add('안녕하세요', 0);
  t.add('좋은 아침', 61_000);
  assert.equal(t.toText(), '안녕하세요\n좋은 아침');
  assert.equal(t.toText({ timestamps: true }), '[00:00] 안녕하세요\n[01:01] 좋은 아침');
  const back = Transcript.fromJSON(JSON.stringify(t));
  assert.deepEqual(back.lines, t.lines);
  t.remove(0);
  assert.equal(t.toText(), '좋은 아침');
});

test('Transcript text export with translations', () => {
  const t = new Transcript([{ at: 0, text: '안녕하세요', ja: 'こんにちは' }, { at: 5000, text: '네' }]);
  assert.equal(t.toText({ translations: true }), '안녕하세요\n→ こんにちは\n네');
  assert.equal(t.toText({ timestamps: true, translations: true }), '[00:00] 안녕하세요\n→ こんにちは\n[00:05] 네');
  assert.equal(t.toText(), '안녕하세요\n네');
  assert.equal(Transcript.fromJSON(JSON.stringify(t)).lines[0].ja, 'こんにちは');
});

test('Transcript text export with reading', () => {
  const t = new Transcript([{ at: 0, text: '네', ja: 'はい' }]);
  assert.equal(t.toText({ translations: true, reading: s => `R:${s}` }), '네\n（R:네）\n→ はい');
  assert.equal(t.toText({ reading: () => '' }), '네');
});

test('Transcript.fromJSON tolerates garbage', () => {
  assert.equal(Transcript.fromJSON('not json').isEmpty, true);
  assert.equal(Transcript.fromJSON('{"a":1}').isEmpty, true);
  assert.equal(Transcript.fromJSON([{ at: 0 }, null, { at: 1, text: '네' }]).lines.length, 1);
});

test('translateUrl encodes Korean text', () => {
  const url = new URL(translateUrl('안녕 하세요'));
  assert.equal(url.hostname, 'translate.google.com');
  assert.equal(url.searchParams.get('sl'), 'ko');
  assert.equal(url.searchParams.get('tl'), 'ja');
  assert.equal(url.searchParams.get('text'), '안녕 하세요');
});
