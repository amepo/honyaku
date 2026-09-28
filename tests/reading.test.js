import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toKana, toRoman, reading } from '../js/reading.js';

// [ハングル, カタカナ, ローマ字]
const CASES = [
  ['안녕하세요', 'アンニョンハセヨ', 'annyeonghaseyo'],
  ['감사합니다', 'カムサハムニダ', 'gamsahamnida'],
  ['한국어', 'ハングゴ', 'hangugeo'],        // 連音化
  ['학교', 'ハッキョ', 'hakgyo'],            // 濃音化（ローマ字では書かない）
  ['좋아요', 'チョアヨ', 'joayo'],           // ㅎ 脱落
  ['좋다', 'チョタ', 'jota'],                // 激音化
  ['축하해요', 'チュカヘヨ', 'chukahaeyo'],  // 激音化
  ['신라', 'シルラ', 'silla'],               // 流音化
  ['설날', 'ソルラル', 'seollal'],           // 流音化
  ['없어요', 'オプソヨ', 'eopseoyo'],        // 二重パッチムの連音
  ['같이', 'カチ', 'gachi'],                 // 口蓋音化
  ['오빠', 'オッパ', 'oppa'],                // 濃音
  ['사랑해', 'サランヘ', 'saranghae'],
  ['맛있어요', 'マシッソヨ', 'masisseoyo'],
  ['읽어요', 'イルゴヨ', 'ilgeoyo'],
  ['한국말', 'ハングンマル', 'hangungmal'],   // 鼻音化
  ['괜찮아요', 'クェンチャナヨ', 'gwaenchanayo'],
  ['의사', 'ウィサ', 'uisa'],
  ['뭐', 'ムォ', 'mwo'],
  ['대학로', 'テハンノ', 'daehangno'],        // ㄱ+ㄹ → ㅇ+ㄴ
  ['십만', 'シムマン', 'simman'],
  ['괜찮아', 'クェンチャナ', 'gwaenchana'],
  ['닭', 'タク', 'dak'],
  ['주세요', 'チュセヨ', 'juseyo'],
  ['시계', 'シゲ', 'sigye'],
];

for (const [ko, kana, roman] of CASES) {
  test(`${ko} → ${kana} / ${roman}`, () => {
    assert.equal(toKana(ko), kana);
    assert.equal(toRoman(ko), roman);
  });
}

test('sentences keep spaces, punctuation and non-Hangul text', () => {
  assert.equal(toKana('저는 BTS를 좋아해요!'), 'チョヌン BTSルル チョアヘヨ!');
  assert.equal(toRoman('네, 알겠어요.'), 'ne, algesseoyo.');
});

test('reading() modes', () => {
  assert.equal(reading('네', 'kana'), 'ネ');
  assert.equal(reading('네', 'roman'), 'ne');
  assert.equal(reading('네', 'off'), '');
});
