"""Export the trained artifacts to frontend/public/model-data for browser inference.

Run from the repository root with the ML environment:

    ml/.venv/Scripts/python.exe scripts/export-browser-model.py     # Windows
    ml/.venv/bin/python       scripts/export-browser-model.py       # macOS / Linux

Writes (all read from ml/models, nothing is re-fitted or approximated):

  manifest.json   scaler, meta-LR, threshold, feature order, ids
  word.json       word TF-IDF vocabulary (33k) + idf
  char.json       char_wb TF-IDF vocabulary (30k) + idf
  lr.json         LogisticRegression weights (63,393 inputs)
  xgb.json        3 calibrated folds: raw tree arrays + sigmoid calibrator
  lgb.json        LightGBM trees
  ref.bin         reference SBERT embeddings (float64)
  vader.json      NLTK VADER lexicon (the same lexicon the service uses)
  fixtures.json   Python ground-truth outputs for scripts/verify-browser-engine.mjs

Float64 is used throughout: the trainer's float32 rounding at split boundaries flipped
tree branches when compared to sklearn/xgboost, so the browser must see the same values.
"""
import base64
import json
import os
import sys

import joblib
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ML = os.path.join(ROOT, "ml")
MODELS = os.path.join(ML, "models")
OUT = os.path.join(ROOT, "frontend", "public", "model-data")
sys.path.insert(0, ML)
os.makedirs(OUT, exist_ok=True)


def b64(array):
    return base64.b64encode(np.asarray(array, dtype="<f8").tobytes()).decode("ascii")


def write(name, obj):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, separators=(",", ":"))
    print(f"  {name:16s} {os.path.getsize(path) / 1024:8.1f} KB")


def load(name):
    return joblib.load(os.path.join(MODELS, name))


def main():
    print("loading trained artifacts ...")
    word = load("word_vectorizer.pkl")
    char = load("char_vectorizer.pkl")
    lr = load("lr_model.pkl")
    xgb = load("xgb_calibrated.pkl")
    lgb = load("lgb_model.pkl")
    meta = load("meta_model.pkl")
    scaler = load("feature_scaler.pkl")
    threshold = float(np.asarray(load("best_threshold.pkl")).reshape(-1)[0])
    columns = [str(c) for c in load("manual_feature_columns.pkl")]
    ref = np.load(os.path.join(MODELS, "reference_embeddings.npy"))

    print("writing model-data ...")
    for name, vec in (("word", word), ("char", char)):
        terms = [None] * len(vec.vocabulary_)
        for term, idx in vec.vocabulary_.items():
            terms[idx] = term
        write(f"{name}.json", {
            "analyzer": vec.analyzer,
            "ngramRange": list(vec.ngram_range),
            "sublinearTf": bool(vec.sublinear_tf),
            "norm": vec.norm,
            "useIdf": bool(vec.use_idf),
            "lowercase": bool(vec.lowercase),
            "tokenPattern": vec.token_pattern,
            "terms": terms,
            "idf": b64(vec.idf_),
        })

    write("lr.json", {
        "coef": b64(lr.coef_.reshape(-1)),
        "intercept": float(lr.intercept_[0]),
        "nFeatures": int(lr.n_features_in_),
    })

    folds = []
    for cc in xgb.calibrated_classifiers_:
        booster = cc.estimator.get_booster()
        raw = json.loads(booster.save_raw(raw_format="json"))
        trees = []
        for tree in raw["learner"]["gradient_booster"]["model"]["trees"]:
            nodes = []
            for i, child in enumerate(tree["left_children"]):
                cond = float(tree["split_conditions"][i])
                if child == -1:
                    nodes.append({"leaf": cond})
                else:
                    nodes.append({
                        "f": int(tree["split_indices"][i]),
                        "t": cond,
                        "l": int(child),
                        "r": int(tree["right_children"][i]),
                        "m": int(tree["default_left"][i]),
                    })
            trees.append(nodes)
        params = json.loads(booster.save_config())["learner"]["learner_model_param"]
        folds.append({
            "trees": trees,
            "baseScore": float(str(params["base_score"]).strip("[]")),
            "calibrator": {"a": float(cc.calibrators[0].a_), "b": float(cc.calibrators[0].b_)},
            "classes": [int(c) for c in cc.estimator.classes_],
        })
    write("xgb.json", {"objective": "binary:logistic", "folds": folds})

    model = lgb.booster_.dump_model()
    lgb_trees = []
    for info in model["tree_info"]:
        nodes = []

        def walk(node):
            idx = len(nodes)
            nodes.append(None)
            if "leaf_value" in node and "split_index" not in node:
                nodes[idx] = {"leaf": float(node["leaf_value"])}
                return idx
            nodes[idx] = {
                "f": int(node["split_feature"]),
                "t": float(node["threshold"]),
                "l": walk(node["left_child"]),
                "r": walk(node["right_child"]),
                "m": 1 if node.get("default_left") else 0,
            }
            return idx

        walk(info["tree_structure"])
        lgb_trees.append(nodes)
    write("lgb.json", {"trees": lgb_trees, "objective": model["objective"]})

    write("manifest.json", {
        "modelId": "frd-stack-v1",
        "modelVersion": "1.0.0",
        "embeddingModel": "all-MiniLM-L6-v2",
        "threshold": threshold,
        "manualColumns": columns,
        "scaler": {"mean": b64(scaler.mean_), "scale": b64(scaler.scale_)},
        "meta": {"coef": b64(meta.coef_.reshape(-1)), "intercept": float(meta.intercept_[0])},
        "referenceCount": int(ref.shape[0]),
        "sbertDim": int(ref.shape[1]),
        "wordFeatures": len(word.vocabulary_),
        "charFeatures": len(char.vocabulary_),
    })

    from nltk.sentiment.vader import SentimentIntensityAnalyzer
    lexicon = SentimentIntensityAnalyzer().lexicon
    write("vader.json", {k: round(float(v), 4) for k, v in lexicon.items()})

    ref.astype("<f8").tofile(os.path.join(OUT, "ref.bin"))
    print(f"  {'ref.bin':16s} {os.path.getsize(os.path.join(OUT, 'ref.bin')) / 1024:8.1f} KB")

    # Ground truth for the parity harness (needs the Sentence-BERT encoder).
    from features import sbert_embedding
    from predictor import ModelBundle, _featurize, _stack_probabilities, _final_classification

    os.chdir(ML)  # MODEL_DIR defaults to "models"
    bundle = ModelBundle()
    cases = [
        ("This kettle is fine. It boils water and the lid closes properly.", 4),
        ("AMAZING!!! Best product EVER!!! Buy it now!!!", 5),
        ("Bought this coffee grinder three weeks ago. The burrs feel solid and the grind is consistent for pour-over. It is a bit loud, but it does the job.", 4),
        ("headphones", 3),
        ("Great value for money, highly recommended to everyone who wants a cheap and reliable blender for daily use at home.", 5),
        ("The item arrived damaged and customer service ignored my emails for two weeks. Very disappointed with this purchase overall.", 1),
        ("ok", 3),
        ("I have used this laptop for six months. Battery life is average, the screen is decent, but the fans get loud under load.", 4),
        ("perfect perfect perfect perfect perfect perfect", 5),
        ("Battery dies after 30 minutes. Cheap plastic. Do not buy.", 1),
    ]
    fixtures = []
    for text, rating in cases:
        core = _featurize(bundle, text, rating)
        pred = _stack_probabilities(bundle, core)
        label, confidence = _final_classification(bundle.threshold, pred["p_fake"])
        fixtures.append({
            "text": text,
            "rating": rating,
            "cleaned": core["cleaned"],
            "sbert": [float(x) for x in np.asarray(sbert_embedding(bundle.embedder, core["cleaned"])).reshape(-1)],
            "manual": {k: float(v) for k, v in core["feature_values"].items()},
            "sim": float(core["sim_score"]),
            "pLr": float(pred["p_lr"]),
            "pXgb": float(pred["p_xgb"]),
            "pLgb": float(pred["p_lgb"]),
            "pFake": float(pred["p_fake"]),
            "label": label,
            "confidence": float(confidence),
            "trustScore": int(round((1 - pred["p_fake"]) * 100)),
        })
    write("fixtures.json", {"threshold": threshold, "cases": fixtures})
    print("done")


if __name__ == "__main__":
    main()
