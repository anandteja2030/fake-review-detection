"""Verification for the recovered inference pipeline (no trained artifacts used).

Covers, in order:
  1. clean_text is byte-identical to the AUTHORITATIVE original snippet
  2. manual-feature formulas vs hand-computed values (incl. VADER source check)
  3. saved manual-column order enforcement + name validation
  4. semantic_similarity == literal cosine_similarity(...).max()
  5. assemble orders: sparse = word+char+sbert+manual, dense = sbert+manual
  6. stacking shape (1,3); classes_ column lookup (incl. REVERSED classes_)
  7. threshold rule at the boundary (>=  Fake, < Genuine)
  8. structural smoke test of predict_review with test doubles -> FastAPI
     contract validation. Doubles are fixed stubs: no training, no randomness,
     never used by the service itself.
  9. zero integration stubs remain
"""
import re
import sys
import numpy as np

sys.path.insert(0, "ml")

FAILURES = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not cond else ""))
    if not cond:
        FAILURES.append(name)


# --- 1. clean_text differential vs the authoritative snippet ---------------
import features

def original_clean_text(text):          # verbatim from the training code
    text = str(text)
    text = re.sub(r"http\S+|www\.\S+", " ", text)
    text = re.sub(r"<.*?>", " ", text)
    text = re.sub(r"[^a-zA-Z0-9\s!?']", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()

samples = [
    "Amazing product! Highly recommended. Excellent quality and best purchase ever!",
    "Check https://example.com/x?y=1 or www.foo.bar now!",
    "<b>Great</b> <script>alert(1)</script> value for money...",
    "Caf\u00e9 R\u00e9sum\u00e9 \U0001F600 emoji 100% 5-star",
    "   multiple \t\n spaces   ",
    "", "   ", "it's a BARGAIN!!!", "123 456",
]
diff = [s for s in samples if features.clean_text(s) != original_clean_text(s)]
check("clean_text identical to authoritative snippet", not diff, f"mismatch on {diff!r}")

# --- 2. manual feature formulas -------------------------------------------
from nltk.sentiment.vader import SentimentIntensityAnalyzer
features.warmup()  # VADER lexicon available
sid = SentimentIntensityAnalyzer()

text = "Amazing product! Highly recommended. Excellent quality and best purchase ever!"
cleaned = features.clean_text(text)
mf = features.manual_features(text, 5, cleaned, sim_score=0.42)

words = cleaned.split()
check("review_length = cleaned word count", mf["review_length"] == float(len(words)) == 10.0,
      f"got {mf['review_length']}")
check("char_length = original text length", mf["char_length"] == float(len(text)),
      f"got {mf['char_length']}")
check("repetition_ratio = repeated/total", mf["repetition_ratio"] == 0.0, f"got {mf['repetition_ratio']}")
exp_sent = float(sid.polarity_scores(cleaned)["compound"])
check("sentiment = VADER compound (cleaned text)", abs(mf["sentiment"] - exp_sent) < 1e-12,
      f"got {mf['sentiment']} expected {exp_sent}")
check("promo_score = matched keywords (amazing, highly recommended, excellent, best)",
      mf["promo_score"] == 4.0, f"got {mf['promo_score']}")
check("rating_sent_gap = abs(rating - ((sentiment+1)*2.5))",
      abs(mf["rating_sent_gap"] - abs(5 - ((exp_sent + 1) * 2.5))) < 1e-12,
      f"got {mf['rating_sent_gap']}")
check("avg_word_length = 68/10 = 6.8", abs(mf["avg_word_length"] - 6.8) < 1e-12,
      f"got {mf['avg_word_length']}")
check("short_flag = 0 for 10 words", mf["short_flag"] == 0)
check("sim_score passed through", mf["sim_score"] == 0.42)

mf2 = features.manual_features("best best best", 1, "best best best", 0.0)
check("repetition_ratio = (3-1)/3", abs(mf2["repetition_ratio"] - 2 / 3) < 1e-12,
      f"got {mf2['repetition_ratio']}")
check("short_flag = 1 when < 5 words", mf2["short_flag"] == 1)
check("promo_score counts presence once", mf2["promo_score"] == 1.0, f"got {mf2['promo_score']}")

mf3 = features.manual_features(" ", 3, "", 0.0)
check("empty cleaned text: no division by zero",
      mf3["repetition_ratio"] == 0.0 and mf3["avg_word_length"] == 0.0
      and mf3["short_flag"] == 1 and mf3["review_length"] == 0.0,
      f"got {mf3}")

# --- 3. manual column order enforcement ------------------------------------
saved = list(features.DOCUMENTED_MANUAL_FEATURES)
row = features.order_manual_features(mf, saved)
check("order matches saved columns", row.shape == (1, 9))
reordered = ["sim_score", "review_length", "char_length", "repetition_ratio", "sentiment",
             "promo_score", "rating_sent_gap", "avg_word_length", "short_flag"]
row2 = features.order_manual_features(mf, reordered)
check("SAVED (shuffled) order wins for the vector",
      np.allclose(row2[0], [mf[k] for k in reordered]) and not np.allclose(row, row2))
try:
    features.order_manual_features(mf, ["bogus_feature"] + saved[1:])
    check("wrong feature name rejected", False)
except ValueError as e:
    check("wrong feature name rejected", "missing" in str(e) or "unexpected" in str(e) or "authoritative" in str(e))
try:
    features.order_manual_features(mf, saved[:8])
    check("short column list rejected", False)
except ValueError:
    check("short column list rejected", True)

# --- 4. semantic similarity literal formula --------------------------------
from sklearn.metrics.pairwise import cosine_similarity
refs = np.array([[1.0, 0.0], [np.sqrt(0.5), np.sqrt(0.5)]])
emb = np.array([[0.0, 1.0]])
expected = float(cosine_similarity(emb, refs).max())  # = sqrt(0.5)
check("similarity = cosine_similarity(...).max()",
      abs(features.semantic_similarity(emb, refs) - expected) < 1e-12,
      f"got {features.semantic_similarity(emb, refs)} expected {expected}")

# --- 5. assembly orders -----------------------------------------------------
from scipy.sparse import csr_matrix

class _VecDouble:  # test double: no fitting anywhere
    def __init__(self, n): self.n = n
    def transform(self, texts): return csr_matrix((1, self.n))
    def get_feature_names_out(self): return np.array([f"f{i}" for i in range(self.n)])

class _ScalerDouble:
    n_features_in_ = 9
    def transform(self, X): return np.asarray(X, dtype=np.float64)

W, C, D = 7, 5, 4
sbert = np.arange(D, dtype=np.float64).reshape(1, D) + 1.0
Xs, Xd = features.assemble_feature_vector(mf, saved, _ScalerDouble(),
                                           _VecDouble(W).transform([cleaned]),
                                           _VecDouble(C).transform([cleaned]), sbert)
check("sparse dim = word+char+sbert+manual", Xs.shape == (1, W + C + D + 9), f"got {Xs.shape}")
check("dense dim = sbert+manual", Xd.shape == (1, D + 9), f"got {Xd.shape}")
manual_scaled = _ScalerDouble().transform(features.order_manual_features(mf, saved))
check("dense = hstack([sbert, manual_scaled])",
      np.allclose(Xd, np.hstack([sbert, manual_scaled])))
check("sparse tail = manual_scaled", np.allclose(np.asarray(Xs.toarray())[0, W + C + D:], manual_scaled[0]))

# --- 6/7. predictor helpers ------------------------------------------------
import predictor
from predictor import (_stack_features, _class_1_probability, _final_classification,
                       _as_threshold, _trust_score, _risk_level, unresolved_stubs,
                       ArtifactError)

S = _stack_features(0.1, 0.2, 0.3)
check("stacking = column_stack -> (1,3)", S.shape == (1, 3) and np.allclose(S, [[0.1, 0.2, 0.3]]),
      f"got {S.shape} {S}")

class _ModelDouble:
    def __init__(self, classes, row, n_features):
        self.classes_ = np.array(classes)
        self.n_features_in_ = n_features
        self._row = np.array([row], dtype=np.float64)
    def predict_proba(self, X):
        assert X.shape[1] == self.n_features_in_, \
            f"input dim {X.shape[1]} != model expectation {self.n_features_in_}"
        return self._row

p = _class_1_probability(_ModelDouble([0, 1], [0.2, 0.8], 3), np.zeros((1, 3)), "t")
check("class-1 prob with classes_[0,1] = column 1", p == 0.8, f"got {p}")
p_rev = _class_1_probability(_ModelDouble([1, 0], [0.9, 0.1], 3), np.zeros((1, 3)), "t")
check("class-1 prob with REVERSED classes_[1,0] = column 0 (no blind column-1 assumption)",
      p_rev == 0.9, f"got {p_rev}")
try:
    _class_1_probability(_ModelDouble([0, 2], [0.5, 0.5], 3), np.zeros((1, 3)), "t")
    check("non-binary classes rejected", False)
except ArtifactError:
    check("non-binary classes rejected", True)

lab, conf = _final_classification(0.5, 0.5)
check("boundary proba == threshold -> fake", lab == "fake" and conf == 0.5, f"{lab} {conf}")
lab, conf = _final_classification(0.5, 0.4999)
check("proba < threshold -> genuine", lab == "genuine" and abs(conf - 0.5001) < 1e-12, f"{lab} {conf}")
check("trust derived int in [0,100]", _trust_score(0.72) == 28 and isinstance(_trust_score(0.72), int))
check("risk derived high/low", _risk_level("fake") == "high" and _risk_level("genuine") == "low")
check("threshold scalar ok", _as_threshold(0.62) == 0.62 and _as_threshold(np.array([0.4])) == 0.4)
for bad in (1.5, -0.1, [0.4, 0.6], {"a": 1}):
    try:
        _as_threshold(bad); check(f"threshold {bad!r} rejected", False)
    except ArtifactError:
        check(f"threshold {bad!r} rejected", True)

check("zero integration stubs remain", features.integration_stubs() == [] and unresolved_stubs() == [],
      f"{features.integration_stubs()} / {unresolved_stubs()}")

# --- 8. structural smoke test of predict_review (test doubles) -------------
class _EmbedderDouble:
    def encode(self, texts, normalize_embeddings=True):
        assert normalize_embeddings is True, "training used normalize_embeddings=True"
        return np.full((1, D), 0.5, dtype=np.float64)
    def get_sentence_embedding_dimension(self): return D

def make_bundle(meta_p, threshold):
    b = predictor.ModelBundle.__new__(predictor.ModelBundle)
    b.lr_model = _ModelDouble([0, 1], [1 - 0.8, 0.8], W + C + D + 9)   # class-1 = 0.8
    b.xgb_model = _ModelDouble([0, 1], [1 - 0.7, 0.7], D + 9)
    b.lgb_model = _ModelDouble([0, 1], [1 - 0.6, 0.6], D + 9)
    b.meta_model = _ModelDouble([0, 1], [1 - meta_p, meta_p], 3)
    b.word_vectorizer = _VecDouble(W)
    b.char_vectorizer = _VecDouble(C)
    b.feature_scaler = _ScalerDouble()
    b.manual_feature_columns = saved
    b.reference_embeddings = np.vstack([np.ones(D), 0.5 * np.ones(D)])
    b.embedder = _EmbedderDouble()
    b.threshold = threshold
    return b

res = predictor.predict_review(make_bundle(0.72, 0.5), text, 5)
check("label is binary fake/genuine", res["label"] == "fake", f"got {res['label']}")
check("probabilities has 3 numeric keys with suspicious=0.0",
      set(res["probabilities"]) == {"fake", "suspicious", "genuine"}
      and isinstance(res["probabilities"]["suspicious"], (int, float))
      and res["probabilities"]["suspicious"] == 0.0
      and abs(res["probabilities"]["fake"] - 0.72) < 1e-12
      and abs(res["probabilities"]["genuine"] - 0.28) < 1e-12,
      f"got {res['probabilities']}")
check("confidence = meta prob of predicted class", abs(res["confidence"] - 0.72) < 1e-12)
check("derived trust/risk", res["trustScore"] == 28 and res["riskLevel"] == "high")
check("honest empty explanations", res["topEvidence"] == [] and res["suspiciousWords"] == [])
check("model id/version present", res["modelId"] == "frd-stack-v1" and res["modelVersion"] == "1.0.0")

res2 = predictor.predict_review(make_bundle(0.20, 0.5), text, 5)
check("low meta prob -> genuine, confidence = 0.8",
      res2["label"] == "genuine" and abs(res2["confidence"] - 0.8) < 1e-12
      and res2["riskLevel"] == "low", f"{res2['label']} {res2['confidence']} {res2['riskLevel']}")
res3 = predictor.predict_review(make_bundle(0.40, 0.35), text, 5)
check("custom threshold honored (0.40 >= 0.35 -> fake)", res3["label"] == "fake")

import serve
try:
    serve.PredictResponse(**res)
    check("response validates against FastAPI PredictResponse", True)
except Exception as e:
    check("response validates against FastAPI PredictResponse", False, str(e))

print()
if FAILURES:
    print(f"{len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print("ALL CHECKS PASSED")
