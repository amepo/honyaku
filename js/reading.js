/* ハングル → 読み（カタカナ / ローマ字）。
   綴りではなく「実際の発音」に寄せるため、連音化・鼻音化・流音化・激音化・濃音化・口蓋音化を適用する。
   単語（空白や記号で区切られたハングルの並び）の中だけで規則を当てる。例外語（밟다 など）は扱わない。 */

const INITIALS = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const MEDIALS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// パッチム（終声）は子音の並びで持つ。ㅇ は 'ng'
const FINALS = [[], ['g'], ['kk'], ['g', 's'], ['n'], ['n', 'j'], ['n', 'h'], ['d'], ['r'], ['r', 'g'], ['r', 'm'], ['r', 'b'], ['r', 's'], ['r', 't'], ['r', 'p'], ['r', 'h'], ['m'], ['b'], ['b', 's'], ['s'], ['ss'], ['ng'], ['j'], ['ch'], ['k'], ['t'], ['p'], ['h']];

const LAX_TO_TENSE = { g: 'kk', d: 'tt', b: 'pp', s: 'ss', j: 'jj' };
const H_ASPIRATE = { g: 'k', d: 't', j: 'ch', b: 'p' };

/** 終声を代表音（K N T L M P NG）に。空なら '' */
function representative(fin) {
  if (!fin.length) return '';
  if (fin.length === 2) {
    const key = fin.join('');
    if (key === 'gs' || key === 'rg') return 'K';
    if (key === 'nj' || key === 'nh') return 'N';
    if (key === 'rm') return 'M';
    if (key === 'rp' || key === 'bs') return 'P';
    return 'L'; // rb rs rt rh
  }
  const c = fin[0];
  if (c === 'g' || c === 'kk' || c === 'k') return 'K';
  if (c === 'n') return 'N';
  if (c === 'r') return 'L';
  if (c === 'm') return 'M';
  if (c === 'b' || c === 'p') return 'P';
  if (c === 'ng') return 'NG';
  return 'T'; // d s ss j ch t h
}

const isHangulSyllable = ch => ch >= '가' && ch <= '힣';

function decompose(ch) {
  const code = ch.charCodeAt(0) - 0xac00;
  return {
    ini: INITIALS[Math.floor(code / 588)],
    med: MEDIALS[Math.floor((code % 588) / 28)],
    fin: [...FINALS[code % 28]],
    tensified: false, // 規則で濃音になった（ローマ字では表記しない）
  };
}

/** 1 単語ぶんの音節に発音規則を当てて { ini, med, rep, tensified } の列にする */
export function pronounce(word) {
  const syl = [...word].map(decompose);
  for (let i = 0; i < syl.length; i++) {
    const cur = syl[i];
    const next = syl[i + 1];
    if (!next) break;

    // ㅎ パッチム: 母音の前では消える / ㄱㄷㅈ の前で激音化 / ㅅ の前で ㅆ / ㄴ の前で ㄴ
    if (cur.fin.at(-1) === 'h') {
      if (next.ini === '') {
        cur.fin.pop();
      } else if (H_ASPIRATE[next.ini]) {
        next.ini = H_ASPIRATE[next.ini];
        cur.fin.pop();
      } else if (next.ini === 's') {
        next.ini = 'ss';
        cur.fin.pop();
      } else if (next.ini === 'n') {
        cur.fin.pop();
        if (!cur.fin.length) cur.fin.push('n');
      }
    }

    // 連音化: パッチム + ㅇ で始まる音節 → パッチムが次へ移る（ㅇ パッチムは移らない）
    if (next.ini === '' && cur.fin.length && cur.fin[0] !== 'ng') {
      let moved = cur.fin.pop();
      if (cur.fin.length && moved === 's') {
        moved = 'ss'; // 없어 → 업써
        next.tensified = true;
      }
      if (next.med === 'i' && moved === 'd') moved = 'j'; // 굳이 → 구지
      if (next.med === 'i' && moved === 't') moved = 'ch'; // 같이 → 가치
      next.ini = moved;
      continue;
    }

    const rep = representative(cur.fin);
    // 激音化: ㄱㄷㅂ(ㅈ) + ㅎ → ㅋㅌㅍ(ㅊ)
    if (next.ini === 'h' && (rep === 'K' || rep === 'T' || rep === 'P')) {
      next.ini = rep === 'K' ? 'k' : rep === 'P' ? 'p' : cur.fin.at(-1) === 'j' ? 'ch' : 't';
      cur.fin = [];
      continue;
    }
    cur.rep = rep;
    // 鼻音化・流音化
    if ((rep === 'K' || rep === 'T' || rep === 'P') && next.ini === 'r') next.ini = 'n';
    if ((rep === 'K' || rep === 'T' || rep === 'P') && (next.ini === 'n' || next.ini === 'm')) {
      cur.rep = rep === 'K' ? 'NG' : rep === 'T' ? 'N' : 'M';
    } else if ((rep === 'M' || rep === 'NG') && next.ini === 'r') {
      next.ini = 'n';
    } else if (rep === 'N' && next.ini === 'r') {
      cur.rep = 'L';
    } else if (rep === 'L' && next.ini === 'n') {
      next.ini = 'r';
    } else if ((rep === 'K' || rep === 'T' || rep === 'P') && LAX_TO_TENSE[next.ini]) {
      // 濃音化: 学校 학교 → 학꾜
      next.ini = LAX_TO_TENSE[next.ini];
      next.tensified = true;
    }
  }
  for (const s of syl) s.rep ??= representative(s.fin);
  return syl.map(({ ini, med, rep, tensified }) => ({ ini, med, rep, tensified }));
}

// ---------- ローマ字（文化観光部式ベース・発音どおり） ----------
const FIN_ROMAN = { '': '', K: 'k', N: 'n', T: 't', L: 'l', M: 'm', P: 'p', NG: 'ng' };
const TENSE_TO_LAX = { kk: 'g', tt: 'd', pp: 'b', ss: 's', jj: 'j' };

function wordToRoman(word) {
  const syl = pronounce(word);
  return syl
    .map((s, i) => {
      let ini = s.tensified ? TENSE_TO_LAX[s.ini] : s.ini;
      if (ini === 'r' && syl[i - 1]?.rep === 'L') ini = 'l';
      return ini + s.med + FIN_ROMAN[s.rep];
    })
    .join('');
}

// ---------- カタカナ ----------
// 母音 → [半母音, 基本母音]
const VOWEL = {
  a: ['', 'a'], ae: ['', 'e'], ya: ['y', 'a'], yae: ['y', 'e'], eo: ['', 'o'], e: ['', 'e'], yeo: ['y', 'o'], ye: ['y', 'e'],
  o: ['', 'o'], wa: ['w', 'a'], wae: ['w', 'e'], oe: ['w', 'e'], yo: ['y', 'o'], u: ['', 'u'], wo: ['w', 'o'], we: ['w', 'e'],
  wi: ['w', 'i'], yu: ['y', 'u'], eu: ['', 'u'], ui: ['', 'i'], i: ['', 'i'],
};
const ROWS = {
  '': ['ア', 'イ', 'ウ', 'エ', 'オ'], k: ['カ', 'キ', 'ク', 'ケ', 'コ'], g: ['ガ', 'ギ', 'グ', 'ゲ', 'ゴ'],
  s: ['サ', 'シ', 'ス', 'セ', 'ソ'], t: ['タ', 'ティ', 'トゥ', 'テ', 'ト'], d: ['ダ', 'ディ', 'ドゥ', 'デ', 'ド'],
  n: ['ナ', 'ニ', 'ヌ', 'ネ', 'ノ'], h: ['ハ', 'ヒ', 'フ', 'ヘ', 'ホ'], b: ['バ', 'ビ', 'ブ', 'ベ', 'ボ'],
  p: ['パ', 'ピ', 'プ', 'ペ', 'ポ'], m: ['マ', 'ミ', 'ム', 'メ', 'モ'], r: ['ラ', 'リ', 'ル', 'レ', 'ロ'],
  j: ['ジャ', 'ジ', 'ジュ', 'ジェ', 'ジョ'], ch: ['チャ', 'チ', 'チュ', 'チェ', 'チョ'],
};
const BASE_INDEX = { a: 0, i: 1, u: 2, e: 3, o: 4 };
const SMALL_Y = { a: 'ャ', u: 'ュ', o: 'ョ', e: 'ェ' };
const SMALL_W = { a: 'ァ', i: 'ィ', e: 'ェ', o: 'ォ' };
const Y_ALONE = { a: 'ヤ', u: 'ユ', o: 'ヨ', e: 'イェ' };
const W_ALONE = { a: 'ワ', i: 'ウィ', e: 'ウェ', o: 'ウォ' };

// 子音 → [有声の行, 無声の行, 濃音か]
const CONSONANT = {
  g: ['g', 'k'], kk: ['k', 'k', true], k: ['k', 'k'], n: ['n', 'n'], d: ['d', 't'], tt: ['t', 't', true], t: ['t', 't'],
  r: ['r', 'r'], m: ['m', 'm'], b: ['b', 'p'], pp: ['p', 'p', true], p: ['p', 'p'], s: ['s', 's'], ss: ['s', 's', true],
  '': ['', ''], j: ['j', 'ch'], jj: ['ch', 'ch', true], ch: ['ch', 'ch'], h: ['h', 'h'],
};
const VOICED_FINALS = new Set(['', 'N', 'M', 'NG', 'L']);

function kanaSyllable(row, med, wordStart) {
  let [glide, base] = VOWEL[med];
  if (med === 'ui') [glide, base] = row === '' && wordStart ? ['w', 'i'] : ['', 'i']; // 의사 ウィサ / 희 ヒ
  if (med === 'ye' && row !== '') glide = ''; // 계 ケ
  if (glide === 'y' && (row === 'j' || row === 'ch')) glide = ''; // 져 ジョ
  if (glide === 'y' && base === 'i') glide = '';
  const kana = ROWS[row];
  if (!glide) return kana[BASE_INDEX[base]];
  if (glide === 'y') return row === '' ? Y_ALONE[base] : kana[1].replace(/ィ$/, '') + SMALL_Y[base];
  if (base === 'u') return kana[2]; // w + u は無い
  return row === '' ? W_ALONE[base] : kana[2] + SMALL_W[base];
}

function wordToKana(word) {
  const syl = pronounce(word);
  const rows = syl.map((s, i) => {
    const [voiced, voiceless, tense] = CONSONANT[s.ini];
    const prevVoiced = i > 0 && VOICED_FINALS.has(syl[i - 1].rep);
    return { row: prevVoiced ? voiced : voiceless, tense: !!tense };
  });
  let out = '';
  syl.forEach((s, i) => {
    const { row, tense } = rows[i];
    // 母音で終わった音節の後の濃音は「ッ」（오빠 オッパ）
    if (tense && i > 0 && syl[i - 1].rep === '') out += 'ッ';
    out += kanaSyllable(row, s.med, i === 0);
    const nextRow = rows[i + 1]?.row;
    switch (s.rep) {
      case 'N': case 'NG': out += 'ン'; break;
      case 'M': out += 'ム'; break;
      case 'L': out += 'ル'; break;
      case 'T': out += 'ッ'; break;
      case 'K': out += nextRow === 'k' ? 'ッ' : 'ク'; break;
      case 'P': out += nextRow === 'p' ? 'ッ' : 'プ'; break;
    }
  });
  return out;
}

function convert(text, wordFn) {
  let out = '';
  let word = '';
  for (const ch of text) {
    if (isHangulSyllable(ch)) {
      word += ch;
      continue;
    }
    if (word) out += wordFn(word);
    word = '';
    out += ch;
  }
  if (word) out += wordFn(word);
  return out;
}

/** ハングルをカタカナ読みに（ハングル以外はそのまま） */
export const toKana = text => convert(text, wordToKana);

/** ハングルを発音どおりのローマ字に（ハングル以外はそのまま） */
export const toRoman = text => convert(text, wordToRoman);

export function reading(text, mode) {
  if (mode === 'kana') return toKana(text);
  if (mode === 'roman') return toRoman(text);
  return '';
}
