/**
 * VADER sentiment — a faithful port of NLTK 3.x
 * nltk/sentiment/vader.py (the exact implementation the Python service runs).
 *
 * Only `compound` is consumed by the feature pipeline, and NLTK rounds it to
 * 4 decimal places, so that rounding is reproduced here too. The lexicon is
 * the same vader_lexicon.txt shipped by NLTK, exported to model-data/vader.json.
 */

const B_INCR = 0.293;
const B_DECR = -0.293;
const C_INCR = 0.733;
const N_SCALAR = -0.74;

const NEGATE = new Set([
  'aint', 'arent', 'cannot', 'cant', 'couldnt', 'darent', 'didnt', 'doesnt',
  "ain't", "aren't", "can't", "couldn't", "daren't", "didn't", "doesn't",
  'dont', 'hadnt', 'hasnt', 'havent', 'isnt', 'mightnt', 'mustnt', 'neither',
  "don't", "hadn't", "hasn't", "haven't", "isn't", "mightn't", "mustn't",
  'neednt', "needn't", 'never', 'none', 'nope', 'nor', 'not', 'nothing',
  'nowhere', 'oughtnt', 'shant', 'shouldnt', 'uhuh', 'wasnt', 'werent',
  "oughtn't", "shan't", "shouldn't", 'uh-uh', "wasn't", "weren't", 'without',
  'wont', 'wouldnt', "won't", "wouldn't", 'rarely', 'seldom', 'despite'
]);

const BOOSTER_DICT = {
  absolutely: B_INCR, amazingly: B_INCR, awfully: B_INCR, completely: B_INCR,
  considerably: B_INCR, decidedly: B_INCR, deeply: B_INCR, effing: B_INCR,
  enormously: B_INCR, entirely: B_INCR, especially: B_INCR, exceptionally: B_INCR,
  extremely: B_INCR, fabulously: B_INCR, flipping: B_INCR, flippin: B_INCR,
  fricking: B_INCR, frickin: B_INCR, frigging: B_INCR, friggin: B_INCR,
  fully: B_INCR, fucking: B_INCR, greatly: B_INCR, hella: B_INCR, highly: B_INCR,
  hugely: B_INCR, incredibly: B_INCR, intensely: B_INCR, majorly: B_INCR,
  more: B_INCR, most: B_INCR, particularly: B_INCR, purely: B_INCR, quite: B_INCR,
  really: B_INCR, remarkably: B_INCR, so: B_INCR, substantially: B_INCR,
  thoroughly: B_INCR, totally: B_INCR, tremendously: B_INCR, uber: B_INCR,
  unbelievably: B_INCR, unusually: B_INCR, utterly: B_INCR, very: B_INCR,
  almost: B_DECR, barely: B_DECR, hardly: B_DECR, 'just enough': B_DECR,
  'kind of': B_DECR, kinda: B_DECR, kindof: B_DECR, 'kind-of': B_DECR,
  less: B_DECR, little: B_DECR, marginally: B_DECR, occasionally: B_DECR,
  partly: B_DECR, scarcely: B_DECR, slightly: B_DECR, somewhat: B_DECR,
  'sort of': B_DECR, sorta: B_DECR, sortof: B_DECR, 'sort-of': B_DECR
};

const SPECIAL_CASE_IDIOMS = {
  'the shit': 3, 'the bomb': 3, 'bad ass': 1.5, 'yeah right': -2,
  'cut the mustard': 2, 'kiss of death': -1.5, 'hand to mouth': -2
};

// Python's string.punctuation
const PUNC_STR = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const PUNC = new Set(PUNC_STR.split(''));
const PUNC_LIST = ['.', '!', '?', ',', ';', ':', '-', "'", '"', '!!', '!!!', '??', '???', '?!?', '!?!', '?!?!', '!?!?'];
const REGEX_REMOVE_PUNCTUATION = new RegExp('[' + PUNC_STR.replace(/[\\\]^\-]/g, '\\$&') + ']', 'g');

/** Python str.isupper(): has at least one cased char and no lowercase. */
function isUpper(word) {
  return /\p{Lu}/u.test(word) && !/\p{Ll}/u.test(word);
}

/** Python round(x, d) uses ties-to-even; reproduce it for 4 dp consistency. */
function pyRound(value, digits) {
  const m = 10 ** digits;
  const scaled = value * m;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded;
  if (Math.abs(diff - 0.5) < 1e-9) rounded = floor % 2 === 0 ? floor : floor + 1;
  else rounded = Math.round(scaled);
  return rounded / m;
}

function normalize(score, alpha = 15) {
  return score / Math.sqrt(score * score + alpha);
}

function scalarIncDec(word, valence, isCapDiff) {
  let scalar = 0;
  const lower = word.toLowerCase();
  if (lower in BOOSTER_DICT) {
    scalar = BOOSTER_DICT[lower];
    if (valence < 0) scalar *= -1;
    if (isUpper(word) && isCapDiff) scalar += valence > 0 ? C_INCR : -C_INCR;
  }
  return scalar;
}

function negated(inputWords, includeNt = true) {
  if (inputWords.some((w) => NEGATE.has(w.toLowerCase()))) return true;
  if (includeNt && inputWords.some((w) => w.toLowerCase().includes("n't"))) return true;
  for (let i = 0; i + 1 < inputWords.length; i += 1) {
    if (inputWords[i + 1].toLowerCase() === 'least' && inputWords[i].toLowerCase() !== 'at') return true;
  }
  return false;
}

function wordsPlusPunc(text) {
  const noPunc = text.replace(REGEX_REMOVE_PUNCTUATION, '');
  const wordsOnly = new Set(noPunc.split(/\s+/).filter((w) => w.length > 1));
  return wordsOnly;
}

/**
 * NLTK builds its lookup from PUNC_LIST (single AND multi-character entries
 * such as '!!' and '!!!'), so 'amazing!!!' maps to 'amazing'. Stripping only
 * one character would leave the token unmatched and silently lose its valence.
 */
function stripPunctuation(token, wordsOnly) {
  for (const p of PUNC_LIST) {
    if (token.length > p.length && token.startsWith(p) && wordsOnly.has(token.slice(p.length))) {
      return token.slice(p.length);
    }
  }
  for (const p of PUNC_LIST) {
    if (token.length > p.length && token.endsWith(p) && wordsOnly.has(token.slice(0, token.length - p.length))) {
      return token.slice(0, token.length - p.length);
    }
  }
  return token;
}

function wordsAndEmoticons(text) {
  const wordsOnly = wordsPlusPunc(text);
  const wes = text.split(/\s+/).filter((w) => w.length > 1);
  return wes.map((we) => stripPunctuation(we, wordsOnly));
}

function allcapDifferential(words) {
  let allcap = 0;
  for (const w of words) if (isUpper(w)) allcap += 1;
  const diff = words.length - allcap;
  return diff > 0 && diff < words.length;
}

export function createVader(lexicon) {
  const LEX = lexicon;

  function leastCheck(valence, wes, i) {
    if (i > 1 && !(wes[i - 1].toLowerCase() in LEX) && wes[i - 1].toLowerCase() === 'least') {
      if (wes[i - 2].toLowerCase() !== 'at' && wes[i - 2].toLowerCase() !== 'very') {
        return valence * N_SCALAR;
      }
    } else if (i > 0 && !(wes[i - 1].toLowerCase() in LEX) && wes[i - 1].toLowerCase() === 'least') {
      return valence * N_SCALAR;
    }
    return valence;
  }

  function idiomsCheck(valence, wes, i) {
    const onezero = `${wes[i - 1]} ${wes[i]}`;
    const twoonezero = `${wes[i - 2]} ${wes[i - 1]} ${wes[i]}`;
    const twoone = `${wes[i - 2]} ${wes[i - 1]}`;
    const threetwoone = `${wes[i - 3]} ${wes[i - 2]} ${wes[i - 1]}`;
    const threetwo = `${wes[i - 3]} ${wes[i - 2]}`;
    let v = valence;
    for (const seq of [onezero, twoonezero, twoone, threetwoone, threetwo]) {
      if (seq in SPECIAL_CASE_IDIOMS) { v = SPECIAL_CASE_IDIOMS[seq]; break; }
    }
    if (wes.length - 1 > i) {
      const zeroone = `${wes[i]} ${wes[i + 1]}`;
      if (zeroone in SPECIAL_CASE_IDIOMS) v = SPECIAL_CASE_IDIOMS[zeroone];
    }
    if (wes.length - 1 > i + 1) {
      const zeroonetwo = `${wes[i]} ${wes[i + 1]} ${wes[i + 2]}`;
      if (zeroonetwo in SPECIAL_CASE_IDIOMS) v = SPECIAL_CASE_IDIOMS[zeroonetwo];
    }
    if (threetwo in BOOSTER_DICT || twoone in BOOSTER_DICT) v += B_DECR;
    return v;
  }

  function neverCheck(valence, wes, startI, i) {
    let v = valence;
    if (startI === 0) {
      if (negated([wes[i - 1]])) v *= N_SCALAR;
    }
    if (startI === 1) {
      if (wes[i - 2] === 'never' && (wes[i - 1] === 'so' || wes[i - 1] === 'this')) v *= 1.5;
      else if (negated([wes[i - (startI + 1)]])) v *= N_SCALAR;
    }
    if (startI === 2) {
      if ((wes[i - 3] === 'never' && (wes[i - 2] === 'so' || wes[i - 2] === 'this'))
        || (wes[i - 1] === 'so' || wes[i - 1] === 'this')) v *= 1.25;
      else if (negated([wes[i - (startI + 1)]])) v *= N_SCALAR;
    }
    return v;
  }

  function sentimentValence(valence, wes, isCapDiff, item, i, sentiments) {
    let v = valence;
    let set = false;
    const lower = item.toLowerCase();
    if (lower in LEX) {
      v = LEX[lower];
      set = true;
      if (isUpper(item) && isCapDiff) v += v > 0 ? C_INCR : -C_INCR;
      for (let startI = 0; startI < 3; startI += 1) {
        if (i > startI && !(wes[i - (startI + 1)].toLowerCase() in LEX)) {
          let s = scalarIncDec(wes[i - (startI + 1)], v, isCapDiff);
          if (startI === 1 && s !== 0) s *= 0.95;
          if (startI === 2 && s !== 0) s *= 0.9;
          v += s;
          v = neverCheck(v, wes, startI, i);
          if (startI === 2) v = idiomsCheck(v, wes, i);
        }
      }
      v = leastCheck(v, wes, i);
    }
    void set;
    sentiments.push(v);
    return sentiments;
  }

  function butCheck(wes, sentiments) {
    const lower = wes.map((w) => w.toLowerCase());
    const bi = lower.indexOf('but');
    if (bi !== -1) {
      for (let i = 0; i < sentiments.length; i += 1) {
        if (i < bi) sentiments[i] *= 0.5;
        else if (i > bi) sentiments[i] *= 1.5;
      }
    }
    return sentiments;
  }

  function amplifyEp(text) {
    let count = (text.match(/!/g) || []).length;
    if (count > 4) count = 4;
    return count * 0.292;
  }

  function amplifyQm(text) {
    const count = (text.match(/\?/g) || []).length;
    if (count > 1) return count <= 3 ? count * 0.18 : 0.96;
    return 0;
  }

  function sift(sentiments) {
    let pos = 0; let neg = 0; let neu = 0;
    for (const s of sentiments) {
      if (s > 0) pos += s + 1;
      if (s < 0) neg += s - 1;
      if (s === 0) neu += 1;
    }
    return { pos, neg, neu };
  }

  function scoreValence(sentiments, text) {
    let compound; let posSum; let negSum; let neuCount;
    if (sentiments.length) {
      let sumS = sentiments.reduce((a, b) => a + b, 0);
      const punct = amplifyEp(text) + amplifyQm(text);
      if (sumS > 0) sumS += punct;
      else if (sumS < 0) sumS -= punct;
      compound = normalize(sumS);
      const s = sift(sentiments);
      posSum = s.pos; negSum = s.neg; neuCount = s.neu;
      if (posSum > Math.abs(negSum)) posSum += punct;
      else if (posSum < Math.abs(negSum)) negSum -= punct;
      const total = posSum + Math.abs(negSum) + neuCount;
      posSum = Math.abs(posSum / total);
      negSum = Math.abs(negSum / total);
      neuCount = Math.abs(neuCount / total);
    } else {
      compound = 0; posSum = 0; negSum = 0; neuCount = 0;
    }
    return {
      neg: pyRound(negSum, 3),
      neu: pyRound(neuCount, 3),
      pos: pyRound(posSum, 3),
      compound: pyRound(compound, 4)
    };
  }

  /** Equivalent of SentimentIntensityAnalyzer.polarity_scores(text). */
  function polarityScores(text) {
    const wes = wordsAndEmoticons(String(text));
    const isCapDiff = allcapDifferential(wes);
    const firstIndex = new Map();
    wes.forEach((t, i) => { if (!firstIndex.has(t)) firstIndex.set(t, i); });
    let sentiments = [];
    for (const item of wes) {
      const i = firstIndex.get(item);
      if ((i < wes.length - 1 && item.toLowerCase() === 'kind' && wes[i + 1].toLowerCase() === 'of')
        || item.toLowerCase() in BOOSTER_DICT) {
        sentiments.push(0);
        continue;
      }
      sentiments = sentimentValence(0, wes, isCapDiff, item, i, sentiments);
    }
    sentiments = butCheck(wes, sentiments);
    return scoreValence(sentiments, String(text));
  }

  return { polarityScores, lexiconSize: Object.keys(LEX).length };
}
