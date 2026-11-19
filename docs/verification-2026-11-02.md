# Verification report — 2026-11-02

Full-stack verification of the Fake Review Detection workspace after the model audit,
Prediction History repair, Explainable AI rebuild and application-wide redesign.

## 1. Runtime used for verification

| Service | Command | Port | Result |
| --- | --- | --- | --- |
| FastAPI ML | `ml/.venv/Scripts/python.exe serve.py` | 8501 | `{"status":"ok","artifactsLoaded":true,"unresolvedStubs":[]}` |
| Express API | `PORT=4000 ML_ADAPTER_MODE=python-http ML_SERVICE_URL=http://127.0.0.1:8501/predict node src/server.js` | 4000 | `model connected: true` |
| Vite frontend | `npm run dev` | 5173 | `/api` proxy → `http://127.0.0.1:4000` |

The proxy target in `frontend/vite.config.js` was confirmed as
`'/api': 'http://127.0.0.1:4000'`; `/api/health` through the proxy returns the Express
service identity. The ML adapter URL must include `/predict` (a root URL returns 404 and
leaves the Analyzer waiting).

## 2. Model audit

Detailed evidence: [`docs/audit-2026-11-01.md`](audit-2026-11-01.md).

- **Class mapping:** all saved estimators expose `classes_ = [0, 1]`; the pipeline locates
  the class-1 column with `_class_1_probability()` instead of assuming column order. The
  served `probabilities.fake` and `probabilities.genuine` are complementary, and the verdict
  (`p_fake >= 0.47375`) matches those numbers. No fake/genuine inversion was found.
- **Why the promotional example scored 98.7 % Genuine:** the scaled `promo_score` weight is
  `+0.0113` per SD (six matches ≈ +0.084 logit). Length carries `−2.196` per SD toward
  Genuine and the embedding block dominates. On the Ott corpus, promotional language is
  equally common in truthful reviews (`P(deceptive | promo ≥ 4) = 0.469` vs `0.524` at
  zero matches), so promotional wording alone is not a reliable fake signal.
- **Independent evaluation (Ott et al., 1,600 unseen labelled reviews):** accuracy 0.500,
  Fake precision/recall/F1 0.000, ROC-AUC 0.549, PR-AUC 0.537, Brier 0.488; 1,598/1,600
  classified Genuine. The author-reported 94.5 % could not be reproduced. The repository
  contains no training data, split indices or training script, so in/out-of-distribution
  status cannot be proven.
- **Reliability defect found:** `short_flag` is near-constant in training (scaler scale
  0.019). At inference a short review produces a scaled value ≈ 52.6 and `+8.8` logit,
  making short reviews near-deterministically Fake (probes 0.66–0.98).
- **Corrections recommended, not applied:** keep `frd-stack-v1` as-is; version a retrained
  model on a documented split; drop or variance-floor `short_flag`; calibrate the meta-model
  on validation data; select the threshold on validation data; publish verified metrics.
  No artifact, threshold or prediction was modified.

## 3. Prediction History filters

**Cause:** `useFetch(fn, deps = [])` re-runs only when its dependency list changes. History
called it without dependencies, so changing category/verdict updated React state but never
re-ran the request. Analytics had the same pattern.

**Fix:** one history fetch, then pure client-side filtering in
`frontend/src/lib/historyFilters.js`, used by both History and Analytics. Category reads the
saved `productCategory` (legacy rows fall back to `Uncategorized`), verdict reads the saved
`prediction`, search matches review/product/category/rating, selectors combine without
resetting each other, and Reset clears all three. Eight unit tests were added in
`server/tests/historyFilters.test.js`. No history record was rewritten to make filters pass.

## 4. Explainable AI rebuild

The page now presents, for the selected saved record only:

- verdict overview with model output, P(fake)/P(genuine), confidence, derived trust and risk;
- measured-evidence tiles (length, repetition, VADER sentiment, rating/sentiment gap,
  promotional score, reference similarity) labelled **measured**;
- term-ablation bars showing original P(fake), P(fake) after term removal, and the signed
  delta, with an explicit perturbation-sensitivity explanation (not SHAP/LIME, not causal);
- a record-specific explanation summary;
- a limitations panel stating what the evidence cannot establish.

## 5. UI redesign and fixes

- One design system across all seven routes: midnight glass surfaces, layered cyan/blue/
  violet lighting, fine hairline edges, display typography, shared page headers and motion.
- Dashboard: React Three Fiber neural globe, floating HUD panels, live ML state and real
  project metrics; reduced-motion and no-WebGL CSS-orb fallbacks; WebGL context loss hides
  the canvas instead of leaving a white block.
- Analyzer result action buttons no longer overlap record metadata.
- Charts render deterministically (Recharts entrance animation removed) so charts cannot
  freeze blank while the tab is in the background.
- Mobile: floating HUD cards are hidden below 760 px because they collided with the globe;
  the live state remains in the topbar. Off-canvas navigation works, no horizontal overflow.
- All numbers and charts are fed by the live API/history; no sample or placeholder series.

## 6. Checks run

| Check | Result |
| --- | --- |
| `npm run build` (frontend) | Pass (chunk-size warning only) |
| `npm test` (server) | **42/42 pass**, including the new filter suite |
| Seven routes loaded in Chrome | Pass |
| Real prediction through the Analyzer UI | GENUINE · P(fake) 1.3 % · P(genuine) 98.7 % · trust 99 · confidence 98.7 % |
| Explainable AI with that exact history record | Pass (verdict, evidence, ablation, summary) |
| Console errors / exceptions / failed requests | **0 / 0 / 0** |
| Mobile 390 × 844 | Pass, menu present, sidebar off-canvas, no horizontal overflow |
| Prediction history | 24 original records preserved; 9 fake / 15 genuine; test records removed |

The Analyzer prediction was run through the live Express → FastAPI path. The three records
created during testing (one probe and two UI runs) were removed afterwards; the original
24 records were left untouched.

## 7. Screenshots

- [Dashboard](../screenshots/verify/01-dashboard.png)
- [Review Analyzer — real result](../screenshots/verify/02-analyzer-result.png)
- [Analytics](../screenshots/verify/03-analytics.png)
- [Explainable AI — promotional record](../screenshots/verify/04b-explainable-promotional.png)
- [Explainable AI — term ablation](../screenshots/verify/04c-explainable-ablation.png)
- [Model Performance](../screenshots/verify/05-model-performance.png)
- [Prediction History](../screenshots/verify/06-history.png)
- [Research / About](../screenshots/verify/07-research.png)
- [Mobile dashboard](../screenshots/verify/08-mobile-dashboard.png)
- [Mobile history](../screenshots/verify/08b-mobile-history.png)

## 8. Changed-file summary

**Frontend** — `src/App.jsx`, `src/main.jsx`, `vite.config.js`, `package.json` (Three.js /
React Three Fiber); seven pages (`Dashboard`, `Analyzer`, `Analytics`, `ExplainableAI`,
`ModelPerformance`, `History`, `Research`); components (`NeuralCore`, `AiOrb`, `Atmosphere`,
`PageHeader`, `QuickAnalysis`, `Icons`, `Sidebar`, `Topbar`, `StatCard`, charts); new
`src/lib/historyFilters.js`; styles (`tokens.css`, `base.css`, `components.css`, new
`design.css`, new `hero.css`).

**Backend** — `server/tests/historyFilters.test.js` (new); `server/src/data/prediction_history.json`
contains only live analyses (no rewritten records).

**ML audit** — `ml/audit_pipeline.py`, `ml/audit_alignment.py`, `ml/audit_dataset_eval.py`
and their JSON/NPY outputs; `docs/audit-2026-11-01.md`.

No commits or pushes were made. Model artifacts and the 0.47375 threshold are unchanged.

## 9. Limitations / next step

The served model is not reliable on the audited corpus (AUC ≈ 0.55), and its reported
metrics remain author-provided. Fixing that requires a documented retrain and evaluation,
which was explicitly left for approval. Until then the UI labels verdicts as model outputs,
shows independent audit results beside reported ones, and never presents them as verified
truth.
