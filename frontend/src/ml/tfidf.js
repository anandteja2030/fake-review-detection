/**
 * TF-IDF transforms for the browser engine.
 *
 * Reproduces sklearn's TfidfVectorizer.transform() for the two SAVED
 * vectorizers (they are never re-fitted here — the vocabulary and idf weights
 * are the trained artifacts exported from ml/models):
 *
 *   word: analyzer='word', ngram_range=(1,2), token_pattern=r'(?u)\b\w\w+\b',
 *         lowercase=True, sublinear_tf=True, norm='l2'
 *   char: analyzer='char_wb', ngram_range=(3,6), sublinear_tf=True, norm='l2'
 *
 * The input is always the cleaned review text, which clean_text() has already
 * lowercased and reduced to [a-zA-Z0-9 !?'] — so the unicode token pattern and
 * the whitespace word split behave exactly as in Python.
 */

function decodeFloat64(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Float64Array(bytes.buffer);
}

export function buildVectorizer(json) {
  const index = new Map();
  for (let i = 0; i < json.terms.length; i += 1) index.set(json.terms[i], i);
  return {
    index,
    idf: decodeFloat64(json.idf),
    ngramRange: json.ngramRange,
    sublinearTf: json.sublinearTf,
    analyzer: json.analyzer
  };
}

/** sklearn token_pattern r'(?u)\b\w\w+\b' over already-lowercased text. */
function wordTokens(text) {
  return text.match(/\b\w\w+\b/g) || [];
}

/** sklearn _char_wb_ngrams: per whitespace word, pad with spaces, slice. */
function charWbNgrams(text, minN, maxN) {
  const counts = new Map();
  const words = text.split(/\s+/).filter(Boolean);
  for (const word of words) {
    const w = ` ${word} `;
    for (let n = minN; n <= maxN; n += 1) {
      for (let i = 0; i + n <= w.length; i += 1) {
        const gram = w.slice(i, i + n);
        counts.set(gram, (counts.get(gram) || 0) + 1);
      }
    }
  }
  return counts;
}

function wordNgrams(text, minN, maxN) {
  const tokens = wordTokens(text);
  const counts = new Map();
  for (let n = minN; n <= maxN; n += 1) {
    for (let i = 0; i + n <= tokens.length; i += 1) {
      const gram = tokens.slice(i, i + n).join(' ');
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Transform one cleaned review into an l2-normalised sparse vector
 * (Map<featureIndex, value>), exactly matching sklearn's transform output.
 */
export function transform(vec, cleanedText) {
  const [minN, maxN] = vec.ngramRange;
  const counts = vec.analyzer === 'char_wb'
    ? charWbNgrams(cleanedText, minN, maxN)
    : wordNgrams(cleanedText, minN, maxN);

  const out = new Map();
  for (const [term, count] of counts) {
    const idx = vec.index.get(term);
    if (idx === undefined) continue; // out-of-vocabulary terms are dropped
    const tf = vec.sublinearTf ? 1 + Math.log(count) : count;
    out.set(idx, tf * vec.idf[idx]);
  }
  let sumSq = 0;
  for (const v of out.values()) sumSq += v * v;
  if (sumSq > 0) {
    const nrm = Math.sqrt(sumSq);
    for (const [k, v] of out) out.set(k, v / nrm);
  }
  return out;
}

/** dot(sparse, denseCoef) where only the sparse indices are visited. */
export function sparseDot(sparse, coef, intercept) {
  let sum = intercept;
  for (const [idx, v] of sparse) sum += coef[idx] * v;
  return sum;
}
