/**
 * Per-review evidence — a port of ml/predictor.py build_explanations().
 *
 * Every value here is computed from the SAME numbers the model consumed for
 * this exact review: measured signals are the 9 input features, term
 * attribution is a real perturbation re-run of the whole pipeline, and
 * anything that cannot be measured is reported unavailable with a reason.
 * Field names match the documented contract the Express API validates.
 */

const PROMO_KEYWORDS = [
  'buy', 'shop', 'discount', 'sale', 'offer', 'limited time', 'exclusive',
  'save', 'free', 'bonus', 'deal', 'promo', 'coupon', 'bargain',
  'great value', 'get yours now', 'order now', 'amazing', 'perfect',
  'best', 'excellent', 'fantastic', 'must buy', 'highly recommended'
];

const ATTRIBUTION_DOC = 'Term-ablation sensitivity: each listed term is deleted from the submitted '
  + 'review text and the full model pipeline is re-run. '
  + 'deltaFakeProbability = P(fake | original text) - P(fake | term removed); a '
  + 'positive value means the term moved THIS model\'s output toward Fake for THIS '
  + 'review. This is a perturbation measurement, NOT SHAP or LIME, and not a '
  + 'causal claim that the term proves deception.';

const ATTRIBUTION_METHOD = 'term-ablation-perturbation';

const PROMO_REASON = 'promotional keyword from the model\'s PROMO_KEYWORDS list - '
  + 'presence counts once toward the promo_score input feature';
const REPETITION_REASON = 'repeated in this review - contributes to the repetition_ratio input feature';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function promoMatches(cleaned) {
  const out = [];
  for (const kw of PROMO_KEYWORDS) {
    const re = new RegExp(`\\b${escapeRe(kw)}\\b`, 'g');
    const count = (cleaned.match(re) || []).length;
    if (count) out.push({ word: kw, count });
  }
  return out;
}

function repeatedWords(words, limit = 5) {
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

function measuredSignals(f, words, rating, simScore, refCount) {
  const lexical = words.some((w) => /[a-z]/i.test(w));
  const hasWords = words.length > 0;
  const signals = [];
  const add = (key, label, value, unit, description, available = true, reason = null) => {
    signals.push({
      key,
      label,
      value: available ? (typeof value === 'number' ? Number(value) : value) : null,
      unit,
      description,
      available: Boolean(available),
      unavailableReason: reason
    });
  };

  add('review_length', 'Review length', f.review_length, 'words',
    'Word count of the cleaned text - the model\'s review_length input feature.');
  add('char_length', 'Character length', f.char_length, 'chars',
    'Character count of the submitted text - the model\'s char_length input feature.');
  if (hasWords) {
    add('repetition_ratio', 'Repetition ratio', f.repetition_ratio, 'ratio',
      'Occurrences beyond each word\'s first use, divided by total words - the model\'s repetition_ratio input feature.');
  } else {
    add('repetition_ratio', 'Repetition ratio', null, 'ratio',
      'Occurrences beyond each word\'s first use, divided by total words.',
      false, 'The cleaned text contains no word tokens, so repetition is undefined (the pipeline guard fed 0.0 to the model).');
  }
  if (lexical) {
    add('sentiment', 'Sentiment (VADER compound)', f.sentiment, 'compound',
      'VADER compound sentiment of the cleaned text, from -1 (most negative) to +1 (most positive) - the model\'s sentiment input feature.');
  } else {
    add('sentiment', 'Sentiment (VADER compound)', null, 'compound',
      'VADER compound sentiment of the cleaned text, from -1 to +1.',
      false, 'The cleaned text has no lexical content, so the compound score carries no sentiment information.');
  }
  add('promo_score', 'Promotional keyword score', f.promo_score, 'keywords',
    'Number of PROMO_KEYWORDS matched in the cleaned text - the model\'s promo_score input feature.');
  if (lexical) {
    add('rating_sent_gap', 'Rating-sentiment gap', f.rating_sent_gap, 'gap',
      'abs(rating - ((sentiment + 1) * 2.5)) - mismatch between the star rating and VADER sentiment, the model\'s rating_sent_gap input feature.');
  } else {
    add('rating_sent_gap', 'Rating-sentiment gap', null, 'gap',
      'abs(rating - ((sentiment + 1) * 2.5)) - mismatch between star rating and sentiment.',
      false, 'Depends on sentiment, which is unavailable: the cleaned text has no lexical content.');
  }
  if (hasWords) {
    add('avg_word_length', 'Average word length', f.avg_word_length, 'chars',
      'Mean word length of the cleaned text - the model\'s avg_word_length input feature.');
  } else {
    add('avg_word_length', 'Average word length', null, 'chars',
      'Mean word length of the cleaned text.',
      false, 'The cleaned text contains no word tokens, so an average is undefined.');
  }
  add('short_flag', 'Short-review flag', f.short_flag, '0 or 1',
    '1 when the cleaned text has fewer than 5 words, else 0 - the model\'s short_flag input feature.');
  add('sim_score', 'Reference similarity', simScore, 'cosine',
    `Maximum cosine similarity between this review's SBERT embedding and the ${refCount} stored reference review embeddings - the model's sim_score input feature.`);
  return signals;
}

function ablateTerm(text, term) {
  const pattern = new RegExp(`\\b${term.split(/\s+/).map(escapeRe).join('\\s+')}\\b`, 'gi');
  const ablated = text.replace(pattern, ' ');
  if (ablated === text || !ablated.trim()) return null;
  return ablated;
}

const fx = (x, d) => x.toFixed(d);

/**
 * @param {object} p
 * @param {string} p.text raw submitted review
 * @param {number} p.rating star rating
 * @param {string} p.cleaned cleaned text
 * @param {object} p.featureValues the 9 manual features
 * @param {number} p.simScore reference similarity
 * @param {object} p.pred { pLr, pXgb, pLgb, pFake }
 * @param {string} p.label final label
 * @param {number} p.threshold decision threshold
 * @param {number} p.refCount stored reference embeddings
 * @param {(text: string) => Promise<number>} p.rerunP ablate -> P(fake)
 */
export async function buildEvidence({ text, rating, cleaned, featureValues, simScore, pred, label, threshold, refCount, rerunP }) {
  const f = featureValues;
  const words = cleaned.split(/\s+/).filter(Boolean);
  const pFake = pred.pFake;
  const lexical = words.some((w) => /[a-z]/i.test(w));

  const promo = promoMatches(cleaned);
  const repeated = repeatedWords(words);

  // --- term-ablation attribution (real re-runs, bounded) -------------------
  const candidates = [];
  for (const m of promo) candidates.push(m.word);
  for (const r of repeated) if (!candidates.includes(r.word)) candidates.push(r.word);
  const budget = candidates.slice(0, 5);

  let attribution;
  if (!budget.length) {
    attribution = {
      method: null,
      status: 'unavailable',
      unavailableReason: 'This review contains no promotional matches and no repeated words, so there are no candidate terms to ablate.',
      description: ATTRIBUTION_DOC,
      terms: []
    };
  } else {
    const terms = [];
    const failures = [];
    const t0 = Date.now();
    for (const term of budget) {
      if (Date.now() - t0 > 2500) {
        failures.push(`time budget exceeded after ${terms.length} evaluated term(s)`);
        break;
      }
      const ablated = ablateTerm(text, term);
      if (ablated === null) {
        failures.push(`'${term}' could not be located in the raw text`);
        continue;
      }
      try {
        const pWithout = await rerunP(ablated);
        const labelWithout = pWithout >= threshold ? 'fake' : 'genuine';
        terms.push({
          term,
          pFakeOriginal: pFake,
          pFakeWithoutTerm: pWithout,
          deltaFakeProbability: pFake - pWithout,
          labelWithoutTerm: labelWithout,
          wouldChangeLabel: labelWithout !== label
        });
      } catch (err) {
        failures.push(`'${term}': ${err && err.message ? err.message : 'error'}`);
      }
    }
    attribution = terms.length
      ? {
        method: ATTRIBUTION_METHOD,
        status: 'available',
        description: ATTRIBUTION_DOC,
        unavailableReason: null,
        terms,
        ...(failures.length ? { partialFailures: failures } : {})
      }
      : {
        method: ATTRIBUTION_METHOD,
        status: 'unavailable',
        unavailableReason: `Term-ablation did not complete: ${failures.join('; ') || 'no term could be evaluated'}`,
        description: ATTRIBUTION_DOC,
        terms: []
      };
  }

  // --- suspicious words ----------------------------------------------------
  const suspicious = promo.map((m) => ({ word: m.word, count: m.count, reason: PROMO_REASON }));
  const seen = new Set(promo.map((m) => m.word));
  for (const r of repeated) {
    if (!seen.has(r.word)) suspicious.push({ word: r.word, count: r.count, reason: REPETITION_REASON });
  }

  // --- topEvidence ---------------------------------------------------------
  const agree = ['pLr', 'pXgb', 'pLgb'].filter((k) => pred[k] >= 0.5).length;
  const top = [
    {
      id: 'decision',
      category: 'model',
      label: `Stacking ensemble verdict: ${label.toUpperCase()}`,
      detail: `P(fake) = ${fx(pFake, 4)} vs decision threshold ${fx(threshold, 4)} -> ${label.toUpperCase()} (confidence ${fx(Math.max(pFake, 1 - pFake), 4)}).`
    },
    {
      id: 'base-learners',
      category: 'model',
      label: `Base-learner Fake probabilities (${agree}/3 above 0.5)`,
      detail: `Logistic Regression ${fx(pred.pLr, 4)} · XGBoost ${fx(pred.pXgb, 4)} · LightGBM ${fx(pred.pLgb, 4)} feed the stacking meta-model.`
    }
  ];
  if (promo.length) {
    top.push({
      id: 'promo-language',
      category: 'measured',
      label: `${promo.length} promotional term(s) matched in this review`,
      detail: `Matches: ${promo.map((m) => `'${m.word}'`).join(', ')} - feeds the promo_score input feature. Matching promotional wording is not proof of deception.`
    });
  }
  if (repeated.length) {
    top.push({
      id: 'repetition',
      category: 'measured',
      label: `Repetition ratio ${fx(f.repetition_ratio, 4)}`,
      detail: `Repeated: ${repeated.map((r) => `'${r.word}' ×${r.count}`).join(', ')} - feeds the repetition_ratio input feature.`
    });
  }
  if (lexical) {
    top.push({
      id: 'rating-sentiment',
      category: 'measured',
      label: `Sentiment ${fx(f.sentiment, 4)} vs ${rating}★ rating (gap ${fx(f.rating_sent_gap, 4)})`,
      detail: 'VADER compound sentiment of this text against the submitted star rating - the model\'s rating_sent_gap input feature.'
    });
  } else {
    top.push({
      id: 'rating-sentiment',
      category: 'measured',
      label: 'Sentiment-rating relationship unavailable',
      detail: 'The cleaned text has no lexical content, so sentiment and the rating-sentiment gap carry no information for this review.'
    });
  }
  top.push({
    id: 'reference-similarity',
    category: 'measured',
    label: `Reference similarity ${fx(simScore, 4)}`,
    detail: `Max cosine similarity between this review's SBERT embedding and ${refCount} stored reference reviews.`
  });
  if (f.short_flag === 1) {
    top.push({
      id: 'short-text',
      category: 'measured',
      label: 'Short review (short_flag = 1)',
      detail: `Only ${words.length} token(s) after cleaning; the model's short_flag input feature is 1.`
    });
  }
  if (attribution.status === 'available') {
    for (const t of [...attribution.terms].sort((a, b) => Math.abs(b.deltaFakeProbability) - Math.abs(a.deltaFakeProbability)).slice(0, 3)) {
      const flip = t.wouldChangeLabel ? ` and the verdict would flip to ${t.labelWithoutTerm.toUpperCase()}` : '';
      top.push({
        id: `attribution:${t.term}`,
        category: 'attribution',
        label: `Ablating '${t.term}' changed P(fake) by ${t.deltaFakeProbability >= 0 ? '+' : ''}${fx(t.deltaFakeProbability, 4)}`,
        detail: `P(fake) ${fx(t.pFakeOriginal, 4)} -> ${fx(t.pFakeWithoutTerm, 4)} when the term is removed${flip}.`
      });
    }
  } else {
    top.push({
      id: 'attribution',
      category: 'attribution',
      label: 'Term-ablation attribution unavailable',
      detail: attribution.unavailableReason
    });
  }

  // --- explanationSummary --------------------------------------------------
  const s = [`The model classified this ${words.length}-token review as ${label.toUpperCase()} (P(fake)=${fx(pFake, 4)} against a decision threshold of ${fx(threshold, 4)}).`];
  if (promo.length) {
    s.push(`Measured promotional language: ${promo.map((m) => `'${m.word}'`).join(', ')} (${promo.length} match(es) feeding promo_score).`);
  } else {
    s.push('No keywords from the promotional list appear in this text (promo_score = 0).');
  }
  if (repeated.length) {
    s.push(`Measured repetition: ratio ${fx(f.repetition_ratio, 4)}, most repeated: ${repeated.slice(0, 3).map((r) => `'${r.word}' ×${r.count}`).join(', ')}.`);
  } else {
    s.push('No word repeats beyond first occurrences were detected in this text.');
  }
  if (lexical) {
    s.push(`Sentiment-rating relationship: VADER compound ${fx(f.sentiment, 4)} with a ${rating}★ rating (gap ${fx(f.rating_sent_gap, 4)}, a model input).`);
  } else {
    s.push('Sentiment and the rating-sentiment gap could not be measured meaningfully because the cleaned text has no lexical content.');
  }
  s.push(`Similarity to the stored reference reviews: ${fx(simScore, 4)}.`);
  if (attribution.status === 'available') {
    const best = attribution.terms.reduce((a, b) => (Math.abs(b.deltaFakeProbability) > Math.abs(a.deltaFakeProbability) ? b : a));
    s.push(`Term-ablation perturbation evaluated ${attribution.terms.length} term(s); largest effect: '${best.term}' (ΔP(fake) = ${best.deltaFakeProbability >= 0 ? '+' : ''}${fx(best.deltaFakeProbability, 4)}).`);
  } else {
    s.push(`Term-ablation attribution is unavailable for this review: ${attribution.unavailableReason}`);
  }
  s.push('These are measured model inputs and perturbation sensitivities - they document what was computed for this review, not proof of deception and not causal attribution.');

  return {
    version: 1,
    reviewText: text,
    threshold,
    topEvidence: top,
    suspiciousWords: suspicious,
    measuredSignals: measuredSignals(f, words, rating, simScore, refCount),
    explanationSummary: s.join(' '),
    limitations: [
      'Measured signals are inputs to the model and diagnostics on the text; they do not establish why the ensemble produced its verdict.',
      'Term-ablation attribution is a perturbation sensitivity measurement on this trained model - not SHAP, not LIME, and not a causal claim.',
      'The classifier detects statistical patterns in wording; it cannot verify whether any individual review is genuinely deceptive.'
    ],
    attribution
  };
}

export { PROMO_KEYWORDS };
