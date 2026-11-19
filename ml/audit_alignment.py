"""Alignment probe: does the saved LR/XGB/LGB expect a different concatenation
order or a different text-cleaning convention than the inference code uses?

Read-only. Evaluates every feature-block permutation on a fixed sample of the
external corpus and reports ROC-AUC for deceptive-vs-truthful.
"""
import csv
import itertools
import json
import warnings

import numpy as np
from scipy.sparse import csr_matrix, hstack, vstack
from sklearn.metrics import roc_auc_score

warnings.filterwarnings("ignore")

from predictor import ModelBundle, _featurize
from features import (clean_text, word_tfidf, char_tfidf, sbert_embedding,
                      manual_features, semantic_similarity,
                      order_manual_features)

CSV = "C:/Users/sirid/AppData/Local/Temp/opspam/chicago.csv"
N = 400

all_rows = list(csv.DictReader(open(CSV, encoding="utf-8", errors="replace")))
# The CSV is grouped by class/sentiment block (400 each); sample within blocks
# so the probe set is balanced and both classes are represented.
rows = []
for start in (0, 400, 800, 1200):
    rows.extend(all_rows[start:start + N // 4])
bundle = ModelBundle()

word, char, bert, manual = [], [], [], []
y = []
for r in rows:
    text = (r.get("Ori_Review") or "").strip()
    rating = int(float(r.get("Rating") or 3))
    y.append(1 if str(r.get("Label")).strip() in ("1", "1.0") else 0)
    cleaned = clean_text(text)
    w = word_tfidf(bundle.word_vectorizer, cleaned)
    c = char_tfidf(bundle.char_vectorizer, cleaned)
    e = sbert_embedding(bundle.embedder, cleaned)
    sim = semantic_similarity(e, bundle.reference_embeddings)
    fv = manual_features(text, rating, cleaned, sim)
    m = bundle.feature_scaler.transform(
        order_manual_features(fv, bundle.manual_feature_columns)).reshape(1, -1)
    word.append(w); char.append(c); bert.append(csr_matrix(e)); manual.append(csr_matrix(m))

y = np.array(y)
word = vstack(word).tocsr(); char = vstack(char).tocsr()
bert = vstack(bert).tocsr(); manual = vstack(manual).tocsr()
blocks = {"word": word, "char": char, "bert": bert, "manual": manual}

print("baseline inference order: word,char,bert,manual")
X = hstack([word, char, bert, manual]).tocsr()
print("LR AUC current:", round(roc_auc_score(y, bundle.lr_model.predict_proba(X)[:, 1]), 4))

results = []
for perm in itertools.permutations(["word", "char", "bert", "manual"]):
    Xp = hstack([blocks[b] for b in perm]).tocsr()
    try:
        p = bundle.lr_model.predict_proba(Xp)[:, 1]
        auc = roc_auc_score(y, p)
        results.append((round(auc, 4), perm))
    except Exception as exc:
        results.append((None, perm))
results.sort(key=lambda t: (t[0] is None, -(t[0] or 0)))
print("\n=== LR block-order permutation AUC (top 8) ===")
for auc, perm in results[:8]:
    print(f"  {auc}  {'+'.join(perm)}")

print("\n=== Dense block order (XGB / calibrated, LGB) ===")
D1 = np.hstack([bert.toarray(), manual.toarray()])
D2 = np.hstack([manual.toarray(), bert.toarray()])
for name, model in (("xgb", bundle.xgb_model), ("lgb", bundle.lgb_model)):
    for label, D in (("bert+manual (current)", D1), ("manual+bert", D2)):
        try:
            p = model.predict_proba(D)[:, 1]
            print(f"  {name} {label:24s} AUC={roc_auc_score(y, p):.4f} mean={p.mean():.3f}")
        except Exception as exc:
            print(f"  {name} {label}: {type(exc).__name__}: {exc}")

# Meta-model input permutation, using each base learner's current probability
p_lr = bundle.lr_model.predict_proba(X)[:, 1]
p_xgb = bundle.xgb_model.predict_proba(D1)[:, 1]
p_lgb = bundle.lgb_model.predict_proba(D1)[:, 1]
print("\nbase mean probs:", round(p_lr.mean(), 3), round(p_xgb.mean(), 3), round(p_lgb.mean(), 3))
print("=== meta input order ===")
for perm in itertools.permutations([p_lr, p_xgb, p_lgb]):
    S = np.column_stack(perm)
    pm = bundle.meta_model.predict_proba(S)[:, 1]
    print("  AUC", round(roc_auc_score(y, pm), 4), "mean", round(pm.mean(), 3),
          "order", [round(float(v.mean()), 3) for v in perm])

# Cleaning-convention probe: transform the RAW text instead of cleaned text
print("\n=== TF-IDF input: raw vs cleaned ===")
raw_w = vstack([word_tfidf(bundle.word_vectorizer, (r.get("Ori_Review") or "").strip()) for r in rows]).tocsr()
raw_c = vstack([char_tfidf(bundle.char_vectorizer, (r.get("Ori_Review") or "").strip()) for r in rows]).tocsr()
for label, W, C in (("cleaned (current)", word, char), ("raw", raw_w, raw_c)):
    Xr = hstack([W, C, bert, manual]).tocsr()
    print(f"  {label:16s} LR AUC={roc_auc_score(y, bundle.lr_model.predict_proba(Xr)[:, 1]):.4f}")

json.dump({"lr_perm": [[a, list(p)] for a, p in results]}, open("audit_alignment.json", "w"), indent=2)
print("\nwrote audit_alignment.json")
