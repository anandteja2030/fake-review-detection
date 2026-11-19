"""External evaluation of the trained ensemble on the Ott et al. Deceptive
Opinion Spam corpus (Chicago hotel reviews, 1600 balanced).

Read-only: no artifact is modified. The CSV is an external benchmark obtained
from a public mirror; its label semantics were verified against the upstream
data_prep.py (Label 1 = deceptive, 0 = truthful).

The reference_embeddings.npy artifact is used to SCREEN for overlap with the
project's own reference set; the report includes metrics both on the full
corpus and on the non-overlapping subset.
"""
import csv
import json
import math
import os
import sys

import numpy as np
from sklearn.metrics import (accuracy_score, confusion_matrix, f1_score,
                             precision_score, recall_score, roc_auc_score,
                             average_precision_score, brier_score_loss)

from predictor import ModelBundle, _featurize, _stack_probabilities
from features import PROMO_KEYWORDS, clean_text

CSV_PATH = sys.argv[1] if len(sys.argv) > 1 else "/tmp/opspam/chicago.csv"

rows = list(csv.DictReader(open(CSV_PATH, encoding="utf-8", errors="replace")))
print(f"loaded {len(rows)} reviews")

bundle = ModelBundle()
records = []
for i, r in enumerate(rows):
    text = (r.get("Ori_Review") or "").strip()
    rating = int(float(r.get("Rating") or 3))
    y = 1 if str(r.get("Label")).strip() in ("1", "1.0") else 0
    core = _featurize(bundle, text, rating)
    p = _stack_probabilities(bundle, core)
    f = core["feature_values"]
    records.append({
        "i": i, "y": y, "rating": rating, "p_fake": p["p_fake"],
        "p_lr": p["p_lr"], "p_xgb": p["p_xgb"], "p_lgb": p["p_lgb"],
        "sim_ref": core["sim_score"],
        "review_length": f["review_length"], "promo_score": f["promo_score"],
        "repetition_ratio": f["repetition_ratio"], "sentiment": f["sentiment"],
        "gap": f["rating_sent_gap"],
    })
    if (i + 1) % 200 == 0:
        print(f"  {i + 1}/{len(rows)}", flush=True)

np.save("audit_dataset_records.npy", np.array(records, dtype=object), allow_pickle=True)
json.dump(records, open("audit_dataset_records.json", "w"))

y = np.array([r["y"] for r in records])
p = np.array([r["p_fake"] for r in records])
thr = bundle.threshold


def metrics(mask, name, threshold=None):
    thr_ = thr if threshold is None else threshold
    yy, pp = y[mask], p[mask]
    if len(set(yy.tolist())) < 2:
        return {"slice": name, "n": int(mask.sum()), "note": "single-class slice"}
    pred = (pp >= thr_).astype(int)
    tn, fp, fn, tp = confusion_matrix(yy, pred, labels=[0, 1]).ravel()
    out = {
        "slice": name, "n": int(mask.sum()),
        "positives(deceptive)": int(yy.sum()),
        "accuracy": round(accuracy_score(yy, pred), 4),
        "precision": round(precision_score(yy, pred, zero_division=0), 4),
        "recall": round(recall_score(yy, pred, zero_division=0), 4),
        "f1": round(f1_score(yy, pred, zero_division=0), 4),
        "roc_auc": round(roc_auc_score(yy, pp), 4),
        "pr_auc": round(average_precision_score(yy, pp), 4),
        "tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp),
        "fake_negative_rate": round(fn / max(tn + fp, 1), 4),
        "genuine_false_positive_rate": round(fp / max(tn + fp, 1), 4),
        "mean_p_fake_deceptive": round(float(pp[yy == 1].mean()), 4),
        "mean_p_fake_truthful": round(float(pp[yy == 0].mean()), 4),
    }
    return out


def print_metrics(m):
    if "note" in m:
        print(f"{m['slice']:26s} n={m['n']:4d}  {m['note']}")
        return
    print(f"{m['slice']:26s} n={m['n']:4d} acc={m['accuracy']:.3f} "
          f"P={m['precision']:.3f} R={m['recall']:.3f} F1={m['f1']:.3f} "
          f"AUC={m['roc_auc']:.3f} PR-AUC={m['pr_auc']:.3f} "
          f"TN={m['tn']} FP={m['fp']} FN={m['fn']} TP={m['tp']}")


print("\nthreshold:", thr)
allm = np.ones(len(records), dtype=bool)
print("\n=== OVERALL ===")
print_metrics(metrics(allm, "all (reported-corpus)"))
print_metrics(metrics(allm, "all @0.5", 0.5))

# --- overlap screening ------------------------------------------------------
sims = np.array([r["sim_ref"] for r in records])
for cut in (0.999, 0.99, 0.95):
    print(f"max-sim >= {cut}: {int((sims >= cut).sum())} / {len(sims)}")

unseen = sims < 0.99
print("\n=== NON-OVERLAPPING SUBSET (max sim < 0.99) ===")
print_metrics(metrics(unseen, "unseen subset"))

# --- slices ---------------------------------------------------------------
print("\n=== SLICES ===")
for r in (5, 1):
    print_metrics(metrics((np.array([x['rating'] for x in records]) == r), f"rating {r}"))
promo = np.array([x["promo_score"] for x in records])
for lo, hi in ((0, 0), (1, 2), (3, 4), (5, 99)):
    print_metrics(metrics((promo >= lo) & (promo <= hi), f"promo_score {lo}-{hi}"))
print_metrics(metrics((promo >= 4) & (np.array([x['rating'] for x in records]) == 5),
                      "promo>=4 & rating5"))
length = np.array([x["review_length"] for x in records])
q = np.quantile(length, [0.25, 0.5, 0.75])
print_metrics(metrics(length <= q[0], "shortest quartile"))
print_metrics(metrics(length >= q[2], "longest quartile"))
rep = np.array([x["repetition_ratio"] for x in records])
q2 = np.quantile(rep, [0.75])
print_metrics(metrics(rep >= q2[0], "top-quartile repetition"))
gap = np.array([x["gap"] for x in records])
print_metrics(metrics(gap >= 2.5, "rating-sentiment gap>=2.5"))
print_metrics(metrics(gap < 2.5, "rating-sentiment gap<2.5"))

# --- calibration ----------------------------------------------------------
print("\n=== CALIBRATION ===")
brier = brier_score_loss(y, p)
print("brier:", round(brier, 4))
bins = np.linspace(0, 1, 11)
print(f"{'bin':14s} {'n':>4s} {'mean_p':>8s} {'obs_rate':>9s}")
for lo, hi in zip(bins[:-1], bins[1:]):
    m = (p >= lo) & (p < hi if hi < 1 else p <= hi)
    if m.sum():
        print(f"{lo:.1f}-{hi:.1f}       {int(m.sum()):4d} {p[m].mean():8.3f} {y[m].mean():9.3f}")

# --- base learner contribution ------------------------------------------
print("\n=== BASE LEARNERS (AUC on deceptive vs truthful) ===")
for k in ("p_lr", "p_xgb", "p_lgb"):
    print(k, round(roc_auc_score(y, np.array([r[k] for r in records])), 4))

# --- label consistency of the user's example style -----------------------
print("\n=== PROMOTIONAL LANGUAGE vs GROUND TRUTH ===")
promo_any = promo >= 1
print("reviews with >=1 promo keyword:", int(promo_any.sum()),
      "of which deceptive:", int(y[promo_any].sum()))
print("reviews with >=4 promo keywords:", int((promo >= 4).sum()),
      "of which deceptive:", int(y[promo >= 4].sum()))
print("P(deceptive | promo>=4) =",
      round(float(y[promo >= 4].mean()), 3) if (promo >= 4).sum() else "n/a")
print("P(deceptive | promo==0) =", round(float(y[promo == 0].mean()), 3))

json.dump({"threshold": thr, "brier": brier,
           "overall": metrics(allm, "all"),
           "unseen": metrics(unseen, "unseen"),
           "promo_ge4_deceptive_rate": float(y[promo >= 4].mean()) if (promo >= 4).sum() else None},
          open("audit_dataset_metrics.json", "w"), indent=2)
print("\nwrote audit_dataset_metrics.json")
