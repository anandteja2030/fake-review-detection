/**
 * Gradient-boosted tree evaluation for the exported artifacts.
 *
 * Every node array here came from the trained boosters themselves
 * (xgboost Booster.get_dump(dump_format='json') and LightGBM
 * Booster.dump_model()) — no tree is rebuilt, pruned or approximated.
 */

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

function walk(tree, x, { f32 = false, inclusive = true } = {}) {
  let node = tree[0];
  let guard = 0;
  while (node.leaf === undefined) {
    let value = x[node.f];
    // XGBoost predicts in float32: it rounds features (and stores float32
    // thresholds), so comparing float64 features here can pick the other
    // branch whenever a value sits on a split boundary.
    if (f32) value = Math.fround(value);
    if (Number.isNaN(value)) { node = tree[node.m ? node.l : node.r]; }
    else node = tree[inclusive ? (value <= node.t ? node.l : node.r) : (value < node.t ? node.l : node.r)];
    guard += 1;
    if (guard > 10000) throw new Error('tree traversal did not reach a leaf');
  }
  return node.leaf;
}

/** XGBoost binary:logistic margin -> probability -> sigmoid calibrator. */
export function predictXgbFold(fold, x) {
  let margin = 0;
  for (const tree of fold.trees) margin += walk(tree, x, { f32: true, inclusive: false });
  // XGBoost >= 1.0 stores base_score in probability space and applies it as a
  // margin offset (ProbToMargin => logit for binary:logistic).
  const base = fold.baseScore;
  const startMargin = Math.log(base / (1 - base));
  const raw = sigmoid(startMargin + margin);
  // sklearn _SigmoidCalibration.predict: expit(-(a * T + b))
  const { a, b } = fold.calibrator;
  return 1 / (1 + Math.exp(a * raw + b));
}

/** CalibratedClassifierCV predict_proba = mean of the per-fold probabilities. */
export function predictXgb(xgb, x) {
  let sum = 0;
  for (const fold of xgb.folds) sum += predictXgbFold(fold, x);
  return sum / xgb.folds.length;
}

/** LightGBM binary classifier: sigmoid(sum of leaf values). */
export function predictLgb(lgb, x) {
  let raw = 0;
  for (const tree of lgb.trees) raw += walk(tree, x, { f32: false, inclusive: true });
  return sigmoid(raw);
}

/** Dense vector: SBERT embedding followed by the scaled manual features. */
export function denseVector(sbert, manualScaled) {
  const out = new Float64Array(sbert.length + manualScaled.length);
  out.set(sbert, 0);
  out.set(manualScaled, sbert.length);
  return out;
}

export function logisticProbability(coef, intercept, x) {
  let z = intercept;
  for (let i = 0; i < x.length; i += 1) z += coef[i] * x[i];
  return sigmoid(z);
}
