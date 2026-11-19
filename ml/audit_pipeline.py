"""Read-only audit of the trained pipeline. Does not modify artifacts.

Usage:  python audit_pipeline.py
"""
import json
import os

import numpy as np

from predictor import ModelBundle, _featurize, _stack_probabilities, _model_classes

REVIEW = ("Amazing product!!! The best earbuds ever!!! Absolutely perfect in every way. "
          "Everyone should buy this immediately. Unbelievable sound quality, fantastic "
          "design, and the best experience ever. Highly recommended to everyone!!!")

PROBES = [
    ("promotional_otter", REVIEW, 5),
    ("promo_short", "BUY NOW!! Best deal ever, order now, limited time offer!", 5),
    ("promo_1word", "amazing", 5),
    ("natural_positive", "I have used these earbuds for three weeks. The battery lasts about "
                         "seven hours and the case charges them twice more. Bass is a little "
                         "heavy for my taste but the fit is comfortable.", 4),
    ("natural_negative", "The left earbud stopped charging after ten days. Support asked me to "
                         "reset the case twice, which did not help. Returning them.", 1),
    ("repetitive", "great great great great great great great product product product", 5),
    ("mixed", "Sound quality is excellent, but the app crashes every time I open the EQ. "
              "Battery life is fine. I am not sure I would buy them again.", 3),
    ("mismatch_pos_text", "Terrible. Broke immediately. Complete waste of money.", 5),
    ("mismatch_neg_text", "Absolutely love it, flawless, best purchase of the year.", 1),
    ("long_detailed", " ".join(["I compared this with two other models before buying."] * 1) +
     " The noise cancelling works well on a bus but not in a cafe. After a month the hinge "
     "developed a slight creak. Firmware update 2.1 fixed the connection drop issue I had "
     "with my laptop. For the price I paid on sale, I would recommend them with reservations.", 4),
    ("short_positive", "Great earbuds", 5),
    ("short_negative", "Broke fast", 1),
    ("neutral", "It arrived on Tuesday. The box contained earbuds, a cable and three tips.", 3),
]

bundle = ModelBundle()

print("threshold:", bundle.threshold)
print("word dim:", len(bundle.word_vectorizer.get_feature_names_out()))
print("char dim:", len(bundle.char_vectorizer.get_feature_names_out()))
print("meta coef:", bundle.meta_model.coef_.tolist(), "intercept:", bundle.meta_model.intercept_.tolist())
print()

rows = []
for name, text, rating in PROBES:
    core = _featurize(bundle, text, rating)
    p = _stack_probabilities(bundle, core)
    label = "fake" if p["p_fake"] >= bundle.threshold else "genuine"
    f = core["feature_values"]
    rows.append({
        "probe": name, "label": label, "p_fake": round(p["p_fake"], 4),
        "p_lr": round(p["p_lr"], 4), "p_xgb": round(p["p_xgb"], 4),
        "p_lgb": round(p["p_lgb"], 4),
        "feat": {k: round(v, 4) for k, v in f.items()},
    })
    print(f"{name:18s} {label:7s} p_fake={p['p_fake']:.4f} "
          f"lr={p['p_lr']:.4f} xgb={p['p_xgb']:.4f} lgb={p['p_lgb']:.4f} "
          f"| len={f['review_length']:.0f} promo={f['promo_score']:.0f} "
          f"rep={f['repetition_ratio']:.3f} sent={f['sentiment']:.2f} "
          f"gap={f['rating_sent_gap']:.2f} sim={f['sim_score']:.3f}")

with open("audit_probe_results.json", "w", encoding="utf-8") as fh:
    json.dump(rows, fh, indent=2)
print("\nwrote audit_probe_results.json")
