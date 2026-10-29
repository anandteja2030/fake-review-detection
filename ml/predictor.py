"""
Inference orchestrator for the Fake Review Detection service.

Loads ALL heavy components ONCE at startup (never per request) and reproduces
the ORIGINAL trained inference pipeline exactly:

    clean_text
      -> word TF-IDF / char TF-IDF / SBERT (normalized) / manual features /
         semantic similarity
      -> sparse hstack  -> Logistic Regression  (class-1 probability)
         dense hstack   -> XGBoost, LightGBM   (class-1 probabilities)
      -> 3-column stacking meta-model (meta_model.pkl)
      -> threshold rule: proba >= best_threshold -> Fake, else Genuine
      -> explainable response

CLASS SEMANTICS (original training code): 0 = Genuine, 1 = Fake.
The trained model is BINARY - there is NO trained "Suspicious" class:

  * label is always "fake" or "genuine";
  * probabilities contain exactly two keys, "fake" and "genuine" - there
    is no "suspicious" probability anywhere in the contract;
  * trustScore / riskLevel are DERIVED UI-level values computed from the
    model probability (see their docstrings) - they are NOT model outputs;
  * evidence (topEvidence, suspiciousWords, measuredSignals, summary,
    limitations, attribution) is computed per request from the SAME values
    the model consumed - see build_explanations().

No randomness, no retraining, no heuristics as final prediction. Every
missing artifact or layout mismatch fails startup LOUDLY with a named error -
the service never serves fabricated output.
"""

import os
import pickle
import re
import time

import joblib
import numpy as np

from features import (clean_text, word_tfidf, char_tfidf, sbert_embedding,
                      manual_features, semantic_similarity,
                      assemble_feature_vector, integration_stubs,
                      validate_manual_columns, warmup,
                      DOCUMENTED_MANUAL_FEATURES, PROMO_KEYWORDS)

# ---------------------------------------------------------------------------
# Configuration (env; defaults match .env.example)
# ---------------------------------------------------------------------------
MODEL_ID = os.getenv("MODEL_ID", "frd-stack-v1")
MODEL_VERSION = os.getenv("MODEL_VERSION", "1.0.0")
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
MODEL_DIR = os.getenv("MODEL_DIR", "models")

ARTIFACT_FILES = [
    "lr_model.pkl",
    "xgb_calibrated.pkl",
    "lgb_model.pkl",
    "meta_model.pkl",
    "word_vectorizer.pkl",
    "char_vectorizer.pkl",
    "feature_scaler.pkl",
    "best_threshold.pkl",
    "manual_feature_columns.pkl",
    "reference_embeddings.npy",
]


class ArtifactError(RuntimeError):
    """Raised when a trained artifact is missing, unreadable or inconsistent."""


# ---------------------------------------------------------------------------
# Startup loading - every heavy component exactly once
# ---------------------------------------------------------------------------
def _load_pickle(name):
    path = os.path.join(MODEL_DIR, name)
    if not os.path.exists(path):
        raise ArtifactError(f"Missing trained artifact: {path}")
    try:
        with open(path, "rb") as fh:
            return pickle.load(fh)
    except Exception:
        return joblib.load(path)  # some artifacts are saved with joblib


def _as_threshold(raw) -> float:
    """best_threshold.pkl must be a single probability in [0, 1]
    (original rule: pred = (test_prob_meta >= best_threshold))."""
    try:
        arr = np.asarray(raw, dtype=np.float64).reshape(-1)
    except Exception as exc:
        raise ArtifactError(f"best_threshold.pkl is not numeric: {exc}") from exc
    if arr.size != 1:
        raise ArtifactError(
            f"best_threshold.pkl must be a scalar threshold, got size {arr.size}"
        )
    value = float(arr[0])
    if not 0.0 <= value <= 1.0:
        raise ArtifactError(f"best_threshold.pkl value {value} is not in [0, 1]")
    return value


def _model_classes(model, name) -> np.ndarray:
    """Return the saved model's classes_ as ints; enforce binary 0/1 semantics."""
    classes = getattr(model, "classes_", None)
    if classes is None:
        raise ArtifactError(
            f"{name}: saved model has no classes_ attribute - cannot locate "
            f"class 1 (Fake) without it"
        )
    values = []
    for c in np.asarray(classes).reshape(-1):
        try:
            values.append(int(c))
        except (TypeError, ValueError) as exc:
            raise ArtifactError(
                f"{name}: classes_ must be 0/1 per the original training code, "
                f"got {list(classes)!r}"
            ) from exc
    if len(values) != 2 or set(values) != {0, 1}:
        raise ArtifactError(
            f"{name}: expected binary classes [0=Genuine, 1=Fake], got {values}"
        )
    return np.asarray(values, dtype=np.int64)


def _n_features(model, name) -> int:
    """Expected input dimensionality of a saved model."""
    for attr in ("n_features_in_", "n_features_"):
        value = getattr(model, attr, None)
        if value is not None:
            return int(value)
    raise ArtifactError(
        f"{name}: cannot verify feature dimensions - model exposes neither "
        f"n_features_in_ nor n_features_"
    )


class ModelBundle:
    """Container for everything loaded once at startup."""

    def __init__(self):
        self.lr_model = _load_pickle("lr_model.pkl")
        self.xgb_model = _load_pickle("xgb_calibrated.pkl")
        self.lgb_model = _load_pickle("lgb_model.pkl")
        self.meta_model = _load_pickle("meta_model.pkl")
        self.word_vectorizer = _load_pickle("word_vectorizer.pkl")
        self.char_vectorizer = _load_pickle("char_vectorizer.pkl")
        self.feature_scaler = _load_pickle("feature_scaler.pkl")
        self.best_threshold = _load_pickle("best_threshold.pkl")
        self.manual_feature_columns = _load_pickle("manual_feature_columns.pkl")
        self.reference_embeddings = np.load(
            os.path.join(MODEL_DIR, "reference_embeddings.npy"))

        # Threshold rule from the original training code (validated scalar).
        self.threshold = _as_threshold(self.best_threshold)

        # Sentence-BERT encoder: downloaded/loaded ONCE at process start.
        from sentence_transformers import SentenceTransformer
        self.embedder = SentenceTransformer(EMBEDDING_MODEL_NAME)

        # VADER lexicon must be present before the first request.
        warmup()

        # Verify classes_, vectorizer dims, manual feature order, SBERT dim
        # and final feature dimensions against the saved models.
        self._validate_layout()

        self.status = "ready"

    def _validate_layout(self) -> None:
        try:
            # classes_ of every saved model: 0 = Genuine, 1 = Fake
            for model, name in (
                (self.lr_model, "lr_model.pkl"),
                (self.xgb_model, "xgb_calibrated.pkl"),
                (self.lgb_model, "lgb_model.pkl"),
                (self.meta_model, "meta_model.pkl"),
            ):
                _model_classes(model, name)

            # Manual feature names/order (saved order is what the scaler saw)
            columns = validate_manual_columns(self.manual_feature_columns)
            if columns != DOCUMENTED_MANUAL_FEATURES:
                print(
                    f"[startup] NOTE: saved manual feature order {columns} differs "
                    f"from the documented order {DOCUMENTED_MANUAL_FEATURES}; using "
                    f"the SAVED order (feature_scaler.pkl was fitted on it)."
                )

            # Vectorizer dimensions
            word_dim = int(self.word_vectorizer.get_feature_names_out().shape[0])
            char_dim = int(self.char_vectorizer.get_feature_names_out().shape[0])

            # SBERT dimension vs reference embeddings
            bert_dim = int(self.embedder.get_sentence_embedding_dimension())
            if getattr(self.reference_embeddings, "ndim", None) != 2:
                raise ArtifactError(
                    f"reference_embeddings.npy must be 2-D, got shape "
                    f"{self.reference_embeddings.shape}"
                )
            if int(self.reference_embeddings.shape[1]) != bert_dim:
                raise ArtifactError(
                    f"reference_embeddings.npy row dim "
                    f"{self.reference_embeddings.shape[1]} != SBERT dim {bert_dim}"
                )
            if int(self.reference_embeddings.shape[0]) < 1:
                raise ArtifactError("reference_embeddings.npy contains no rows")

            # Scaler vs manual feature count
            manual_dim = len(columns)
            scaler_dim = getattr(self.feature_scaler, "n_features_in_", None)
            if scaler_dim is not None and int(scaler_dim) != manual_dim:
                raise ArtifactError(
                    f"feature_scaler expects {scaler_dim} features, manual feature "
                    f"columns = {manual_dim}"
                )

            # Final feature dimensions must match what each model was fitted on
            sparse_dim = word_dim + char_dim + bert_dim + manual_dim
            dense_dim = bert_dim + manual_dim

            lr_dim = _n_features(self.lr_model, "lr_model.pkl")
            if lr_dim != sparse_dim:
                raise ArtifactError(
                    f"lr_model.pkl expects {lr_dim} features but word({word_dim}) + "
                    f"char({char_dim}) + sbert({bert_dim}) + manual({manual_dim}) = {sparse_dim}"
                )
            for model, name in ((self.xgb_model, "xgb_calibrated.pkl"),
                                (self.lgb_model, "lgb_model.pkl")):
                dim = _n_features(model, name)
                if dim != dense_dim:
                    raise ArtifactError(
                        f"{name} expects {dim} features but sbert({bert_dim}) + "
                        f"manual({manual_dim}) = {dense_dim}"
                    )
            meta_dim = _n_features(self.meta_model, "meta_model.pkl")
            if meta_dim != 3:
                raise ArtifactError(
                    f"meta_model.pkl expects {meta_dim} meta features; stacking "
                    f"produces exactly 3 (lr, xgb, lgb probabilities of class 1)"
                )
        except ArtifactError:
            raise
        except Exception as exc:
            raise ArtifactError(
                f"bundle layout validation failed: {type(exc).__name__}: {exc}"
            ) from exc


def load_model_bundle() -> ModelBundle:
    """Called ONCE at FastAPI startup; returns the fully loaded bundle."""
    return ModelBundle()


# ---------------------------------------------------------------------------
# Per-request inference path (only transforms + predict_proba run here)
# ---------------------------------------------------------------------------
def _featurize(bundle: ModelBundle, text: str, rating: int) -> dict:
    """Run the shared transform steps once (cleaning, TF-IDF, SBERT,
    similarity, manual features, vector assembly). Used by predict_review()
    AND by the term-ablation attribution, so both see identical math."""
    cleaned = clean_text(text)
    word_matrix = word_tfidf(bundle.word_vectorizer, cleaned)
    char_matrix = char_tfidf(bundle.char_vectorizer, cleaned)
    sbert_vec = sbert_embedding(bundle.embedder, cleaned)
    sim_score = semantic_similarity(sbert_vec, bundle.reference_embeddings)
    feature_values = manual_features(text, rating, cleaned, sim_score)
    X_sparse, X_dense = assemble_feature_vector(
        feature_values, bundle.manual_feature_columns, bundle.feature_scaler,
        word_matrix, char_matrix, sbert_vec)
    return {
        "cleaned": cleaned,
        "feature_values": feature_values,
        "sim_score": sim_score,
        "X_sparse": X_sparse,
        "X_dense": X_dense,
    }


def _stack_probabilities(bundle: ModelBundle, core: dict) -> dict:
    """Base learners + stacking meta-model -> class-1 (Fake) probabilities."""
    p_lr = _class_1_probability(bundle.lr_model, core["X_sparse"], "lr_model.pkl")
    p_xgb = _class_1_probability(bundle.xgb_model, core["X_dense"], "xgb_calibrated.pkl")
    p_lgb = _class_1_probability(bundle.lgb_model, core["X_dense"], "lgb_model.pkl")
    S = _stack_features(p_lr, p_xgb, p_lgb)
    p_fake = _class_1_probability(bundle.meta_model, S, "meta_model.pkl")
    return {"p_fake": float(p_fake), "p_lr": p_lr, "p_xgb": p_xgb, "p_lgb": p_lgb}


def predict_review(bundle: ModelBundle, text: str, rating: int) -> dict:
    """Run the ORIGINAL stacked pipeline on one review.

    Returns the full contract dict. The model is binary: label is "fake" or
    "genuine"; probabilities carry exactly the two trained classes
    {fake, genuine}; trustScore/riskLevel are derived UI-level values.
    `evidence` is a per-review explanation object built by build_explanations()
    from the exact feature values and probabilities computed below.
    """
    core = _featurize(bundle, text, rating)
    pred = _stack_probabilities(bundle, core)
    p_fake = pred["p_fake"]

    # Final threshold rule: proba >= best_threshold -> Fake, else Genuine
    label, confidence = _final_classification(bundle.threshold, p_fake)

    # The trained model is BINARY: exactly two classes, no filler keys.
    probabilities = {
        "fake": float(p_fake),
        "genuine": float(1.0 - p_fake),
    }
    trust_score = _trust_score(p_fake)
    risk_level = _risk_level(label)

    evidence = build_explanations(bundle, text, rating, core, pred, label)

    return {
        "label": label,
        "probabilities": probabilities,
        "confidence": float(confidence),
        "trustScore": int(trust_score),
        "riskLevel": risk_level,
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "evidence": evidence,
    }


def _class_1_probability(model, X, name: str) -> float:
    """Probability of class 1 (Fake) located via the saved model's classes_
    ordering - never assuming column 1 blindly (original training rule)."""
    classes = _model_classes(model, name)
    idx = int(np.flatnonzero(classes == 1)[0])
    proba = np.asarray(model.predict_proba(X), dtype=np.float64)
    if proba.ndim != 2 or proba.shape[0] != 1 or proba.shape[1] != len(classes):
        raise ArtifactError(
            f"{name}: predict_proba returned shape {proba.shape}, "
            f"expected (1, {len(classes)})"
        )
    return float(proba[0, idx])


def _stack_features(p_lr: float, p_xgb: float, p_lgb: float) -> np.ndarray:
    """Original stacking features:

        np.column_stack([val_prob_lr, val_prob_xgb, val_prob_lgb])

    For one review that is a single row of the three class-1 probabilities.
    """
    row = np.column_stack([[p_lr], [p_xgb], [p_lgb]])
    return np.asarray(row, dtype=np.float64)


def _final_classification(threshold: float, p_fake: float):
    """Original decision rule (binary):

        pred = (test_prob_meta >= best_threshold).astype(int)

    -> probability >= best_threshold => Fake (class 1)
    -> probability <  best_threshold => Genuine (class 0)

    Returns (label, confidence) where confidence is the meta model's own
    probability for the predicted class.
    """
    if p_fake >= threshold:
        return "fake", float(p_fake)
    return "genuine", float(1.0 - p_fake)


def _trust_score(p_fake: float) -> int:
    """DERIVED UI-level value - NOT a trained-model output.

    The original inference code for a trust score was not provided, so this
    is an explicitly derived presentation value: the complement of the meta
    model's Fake probability on a 0-100 scale (100 = model assigns ~0
    probability to Fake). The original project may define this differently.
    """
    return int(round((1.0 - p_fake) * 100))


def _risk_level(label: str) -> str:
    """DERIVED UI-level value - NOT a trained-model output.

    Because the model is binary, risk is simply mapped from its verdict:
    Fake -> "high", Genuine -> "low". No "medium" band exists because the
    original project provides no rule that would produce one.
    """
    return "high" if label == "fake" else "low"


# ---------------------------------------------------------------------------
# Per-review evidence - REAL computations from the same values the model used
# ---------------------------------------------------------------------------
# Contract (identical field names end to end: Python -> Express -> frontend ->
# persisted history):  evidence = { version, reviewText, threshold, topEvidence,
# suspiciousWords, measuredSignals, explanationSummary, limitations, attribution }
_EVIDENCE_VERSION = 1

_PROMO_REASON = ("promotional keyword from the model's PROMO_KEYWORDS list - "
                 "presence counts once toward the promo_score input feature")
_REPETITION_REASON = "repeated in this review - contributes to the repetition_ratio input feature"
_ATTRIBUTION_DOC = (
    "Term-ablation sensitivity: each listed term is deleted from the submitted "
    "review text and the full model pipeline is re-run. "
    "deltaFakeProbability = P(fake | original text) - P(fake | term removed); a "
    "positive value means the term moved THIS model's output toward Fake for THIS "
    "review. This is a perturbation measurement, NOT SHAP or LIME, and not a "
    "causal claim that the term proves deception."
)


def _promo_matches(cleaned: str) -> list:
    """Promotional keywords actually present in THIS review's cleaned text,
    using the same substring presence rule as the promo_score feature."""
    matches = []
    for kw in PROMO_KEYWORDS:
        occurrences = len(re.findall(r"\b" + re.escape(kw) + r"\b", cleaned))
        if occurrences:
            matches.append({"word": kw, "count": int(occurrences)})
    return matches


def _repeated_words(words: list, limit: int = 5) -> list:
    """Words that occur at least twice in this review, most frequent first."""
    counts = {}
    for w in words:
        counts[w] = counts.get(w, 0) + 1
    repeated = sorted(((w, c) for w, c in counts.items() if c >= 2),
                      key=lambda wc: (-wc[1], wc[0]))
    return [{"word": w, "count": int(c)} for w, c in repeated[:limit]]


def _measured_signals(feature_values: dict, words: list, rating: int,
                      sim_score: float, ref_count: int) -> list:
    """The model's 9 input features reported verbatim, each with a label and a
    plain-language description of what the measurement is. Signals whose value
    is mathematically undefined for this text are returned as unavailable with
    an explicit reason instead of a fabricated number."""
    f = feature_values
    lexical = any(w.isalpha() for w in words)
    has_words = len(words) > 0
    signals = []

    def add(key, label, value, unit, description, available=True, reason=None):
        signals.append({
            "key": key, "label": label,
            "value": (float(value) if isinstance(value, (int, float)) else value) if available else None,
            "unit": unit, "description": description,
            "available": bool(available),
            "unavailableReason": reason,
        })

    add("review_length", "Review length", f["review_length"], "words",
        "Word count of the cleaned text - the model's review_length input feature.")
    add("char_length", "Character length", f["char_length"], "chars",
        "Character count of the submitted text - the model's char_length input feature.")
    if has_words:
        add("repetition_ratio", "Repetition ratio", f["repetition_ratio"], "ratio",
            "Occurrences beyond each word's first use, divided by total words - the model's repetition_ratio input feature.")
    else:
        add("repetition_ratio", "Repetition ratio", None, "ratio",
            "Occurrences beyond each word's first use, divided by total words.",
            available=False,
            reason="The cleaned text contains no word tokens, so repetition is undefined (the pipeline guard fed 0.0 to the model).")
    if lexical:
        add("sentiment", "Sentiment (VADER compound)", f["sentiment"], "compound",
            "VADER compound sentiment of the cleaned text, from -1 (most negative) to +1 (most positive) - the model's sentiment input feature.")
    else:
        add("sentiment", "Sentiment (VADER compound)", None, "compound",
            "VADER compound sentiment of the cleaned text, from -1 to +1.",
            available=False,
            reason="The cleaned text has no lexical content, so the compound score carries no sentiment information.")
    add("promo_score", "Promotional keyword score", f["promo_score"], "keywords",
        "Number of PROMO_KEYWORDS matched in the cleaned text - the model's promo_score input feature.")
    if lexical:
        add("rating_sent_gap", "Rating-sentiment gap", f["rating_sent_gap"], "gap",
            "abs(rating - ((sentiment + 1) * 2.5)) - mismatch between the star rating and VADER sentiment, the model's rating_sent_gap input feature.")
    else:
        add("rating_sent_gap", "Rating-sentiment gap", None, "gap",
            "abs(rating - ((sentiment + 1) * 2.5)) - mismatch between star rating and sentiment.",
            available=False,
            reason="Depends on sentiment, which is unavailable: the cleaned text has no lexical content.")
    if has_words:
        add("avg_word_length", "Average word length", f["avg_word_length"], "chars",
            "Mean word length of the cleaned text - the model's avg_word_length input feature.")
    else:
        add("avg_word_length", "Average word length", None, "chars",
            "Mean word length of the cleaned text.",
            available=False,
            reason="The cleaned text contains no word tokens, so an average is undefined.")
    add("short_flag", "Short-review flag", f["short_flag"], "0 or 1",
        "1 when the cleaned text has fewer than 5 words, else 0 - the model's short_flag input feature.")
    add("sim_score", "Reference similarity", sim_score, "cosine",
        f"Maximum cosine similarity between this review's SBERT embedding and the {ref_count} stored reference review embeddings - the model's sim_score input feature.")
    return signals


def _ablate_term(text: str, term: str):
    """Delete every occurrence of `term` (word or phrase) from the raw text.
    Returns the new text, or None when the pattern is not actually present."""
    pattern = r"\b" + r"\s+".join(re.escape(w) for w in term.split()) + r"\b"
    ablated = re.sub(pattern, " ", text, flags=re.IGNORECASE)
    if ablated == text or not ablated.strip():
        return None
    return ablated


def _attribution(bundle: ModelBundle, text: str, rating: int, pred: dict,
                 label: str, promo_matches: list, repeated: list,
                 budget_s: float = 2.5) -> dict:
    """Perturbation-based, model-specific term attribution.

    For each candidate term (promotional matches first, then the most repeated
    words) the term is removed from the submitted text and the ENTIRE pipeline
    re-runs, measuring the change in the meta-model's Fake probability. Bounded
    to 5 terms with a wall-clock budget; any failure is reported as unavailable
    - never simulated.
    """
    candidates = [m["word"] for m in promo_matches]
    for r in repeated:
        if r["word"] not in candidates:
            candidates.append(r["word"])
    candidates = candidates[:5]

    if not candidates:
        return {"method": None, "status": "unavailable",
                "unavailableReason": "This review contains no promotional matches and no repeated words, so there are no candidate terms to ablate.",
                "description": _ATTRIBUTION_DOC, "terms": []}

    p_orig = float(pred["p_fake"])
    terms, failures = [], []
    t0 = time.monotonic()
    for term in candidates:
        if time.monotonic() - t0 > budget_s:
            failures.append(f"time budget exceeded after {len(terms)} evaluated term(s)")
            break
        ablated = _ablate_term(text, term)
        if ablated is None:
            failures.append(f"'{term}' could not be located in the raw text")
            continue
        try:
            a_pred = _stack_probabilities(bundle, _featurize(bundle, ablated, rating))
            p_without = float(a_pred["p_fake"])
        except Exception as exc:  # noqa: BLE001 - reported honestly per term
            failures.append(f"'{term}': {type(exc).__name__}: {exc}")
            continue
        label_without = "fake" if p_without >= bundle.threshold else "genuine"
        terms.append({
            "term": term,
            "pFakeOriginal": p_orig,
            "pFakeWithoutTerm": p_without,
            "deltaFakeProbability": p_orig - p_without,
            "labelWithoutTerm": label_without,
            "wouldChangeLabel": bool(label_without != label),
        })

    if not terms:
        return {"method": _ATTRIBUTION_METHOD, "status": "unavailable",
                "unavailableReason": "Term-ablation did not complete: " +
                                     ("; ".join(failures) or "no term could be evaluated"),
                "description": _ATTRIBUTION_DOC, "terms": []}
    out = {"method": _ATTRIBUTION_METHOD, "status": "available",
           "description": _ATTRIBUTION_DOC, "unavailableReason": None,
           "terms": terms}
    if failures:
        out["partialFailures"] = failures
    return out


_ATTRIBUTION_METHOD = "term-ablation-perturbation"


def build_explanations(bundle: ModelBundle, text: str, rating: int,
                       core: dict, pred: dict, label: str) -> dict:
    """Build the real, review-specific evidence object for one prediction.

    Every value below comes from the SAME computation the model consumed in
    predict_review() for THIS exact text and rating. Nothing is guessed:
    unavailable signals carry explicit reasons, and the attribution section
    is marked unavailable whenever the perturbation cannot be completed.
    """
    f = core["feature_values"]
    cleaned = core["cleaned"]
    words = cleaned.split()
    p_fake = float(pred["p_fake"])
    threshold = float(bundle.threshold)
    lexical = any(w.isalpha() for w in words)
    ref_count = int(bundle.reference_embeddings.shape[0])

    promo = _promo_matches(cleaned)
    repeated = _repeated_words(words)
    measured = _measured_signals(f, words, rating, core["sim_score"], ref_count)
    attribution = _attribution(bundle, text, rating, pred, label, promo, repeated)

    # --- suspiciousWords: only words that match implemented, documented signals
    suspicious = [{"word": m["word"], "count": m["count"], "reason": _PROMO_REASON}
                  for m in promo]
    seen = {m["word"] for m in promo}
    for r in repeated:
        if r["word"] not in seen:
            suspicious.append({"word": r["word"], "count": r["count"],
                               "reason": _REPETITION_REASON})

    # --- topEvidence: ordered, review-specific items ------------------------
    n_agree = sum(1 for k in ("p_lr", "p_xgb", "p_lgb") if pred[k] >= 0.5)
    top = [
        {"id": "decision", "category": "model",
         "label": f"Stacking ensemble verdict: {label.upper()}",
         "detail": (f"P(fake) = {p_fake:.4f} vs decision threshold {threshold:.4f} "
                    f"-> {label.upper()} (confidence {max(p_fake, 1 - p_fake):.4f}).")},
        {"id": "base-learners", "category": "model",
         "label": f"Base-learner Fake probabilities ({n_agree}/3 above 0.5)",
         "detail": (f"Logistic Regression {pred['p_lr']:.4f} · XGBoost {pred['p_xgb']:.4f} "
                    f"· LightGBM {pred['p_lgb']:.4f} feed the stacking meta-model.")},
    ]
    if promo:
        top.append({"id": "promo-language", "category": "measured",
            "label": f"{len(promo)} promotional term(s) matched in this review",
            "detail": ("Matches: " + ", ".join(f"'{m['word']}'" for m in promo) +
                       " - feeds the promo_score input feature. Matching promotional "
                       "wording is not proof of deception.")})
    if repeated:
        top.append({"id": "repetition", "category": "measured",
            "label": f"Repetition ratio {f['repetition_ratio']:.4f}",
            "detail": ("Repeated: " + ", ".join(f"'{r['word']}' ×{r['count']}" for r in repeated) +
                       " - feeds the repetition_ratio input feature.")})
    if lexical:
        top.append({"id": "rating-sentiment", "category": "measured",
            "label": f"Sentiment {f['sentiment']:.4f} vs {rating}★ rating (gap {f['rating_sent_gap']:.4f})",
            "detail": ("VADER compound sentiment of this text against the submitted "
                       "star rating - the model's rating_sent_gap input feature.")})
    else:
        top.append({"id": "rating-sentiment", "category": "measured",
            "label": "Sentiment-rating relationship unavailable",
            "detail": ("The cleaned text has no lexical content, so sentiment and "
                       "the rating-sentiment gap carry no information for this review.")})
    top.append({"id": "reference-similarity", "category": "measured",
        "label": f"Reference similarity {core['sim_score']:.4f}",
        "detail": f"Max cosine similarity between this review's SBERT embedding and {ref_count} stored reference reviews."})
    if f["short_flag"] == 1:
        top.append({"id": "short-text", "category": "measured",
            "label": "Short review (short_flag = 1)",
            "detail": f"Only {len(words)} token(s) after cleaning; the model's short_flag input feature is 1."})
    if attribution["status"] == "available":
        for t in sorted(attribution["terms"], key=lambda t: -abs(t["deltaFakeProbability"]))[:3]:
            flip = (f" and the verdict would flip to {t['labelWithoutTerm'].upper()}"
                    if t["wouldChangeLabel"] else "")
            top.append({"id": f"attribution:{t['term']}", "category": "attribution",
                "label": f"Ablating '{t['term']}' changed P(fake) by {t['deltaFakeProbability']:+.4f}",
                "detail": (f"P(fake) {t['pFakeOriginal']:.4f} -> {t['pFakeWithoutTerm']:.4f} "
                           f"when the term is removed{flip}.")})
    elif attribution["status"] == "unavailable":
        top.append({"id": "attribution", "category": "attribution",
            "label": "Term-ablation attribution unavailable",
            "detail": attribution["unavailableReason"]})

    # --- explanationSummary: readable, built ONLY from this review's values --
    s = [f"The model classified this {len(words)}-token review as {label.upper()} "
         f"(P(fake)={p_fake:.4f} against a decision threshold of {threshold:.4f})."]
    if promo:
        s.append("Measured promotional language: " +
                 ", ".join(f"'{m['word']}'" for m in promo) +
                 f" ({len(promo)} match(es) feeding promo_score).")
    else:
        s.append("No keywords from the promotional list appear in this text (promo_score = 0).")
    if repeated:
        s.append("Measured repetition: ratio " + f"{f['repetition_ratio']:.4f}" +
                 ", most repeated: " + ", ".join(f"'{r['word']}' ×{r['count']}" for r in repeated[:3]) + ".")
    else:
        s.append("No word repeats beyond first occurrences were detected in this text.")
    if lexical:
        s.append(f"Sentiment-rating relationship: VADER compound {f['sentiment']:.4f} "
                 f"with a {rating}★ rating (gap {f['rating_sent_gap']:.4f}, a model input).")
    else:
        s.append("Sentiment and the rating-sentiment gap could not be measured meaningfully "
                 "because the cleaned text has no lexical content.")
    s.append(f"Similarity to the stored reference reviews: {core['sim_score']:.4f}.")
    if attribution["status"] == "available":
        best = max(attribution["terms"], key=lambda t: abs(t["deltaFakeProbability"]))
        s.append(f"Term-ablation perturbation evaluated {len(attribution['terms'])} term(s); "
                 f"largest effect: '{best['term']}' (ΔP(fake) = {best['deltaFakeProbability']:+.4f}).")
    else:
        s.append("Term-ablation attribution is unavailable for this review: " +
                 attribution["unavailableReason"])
    s.append("These are measured model inputs and perturbation sensitivities - they document "
             "what was computed for this review, not proof of deception and not causal attribution.")
    summary = " ".join(s)

    limitations = [
        "Measured signals are inputs to the model and diagnostics on the text; they do not establish why the ensemble produced its verdict.",
        "Term-ablation attribution is a perturbation sensitivity measurement on this trained model - not SHAP, not LIME, and not a causal claim.",
        "The classifier detects statistical patterns in wording; it cannot verify whether any individual review is genuinely deceptive.",
    ]

    return {
        "version": _EVIDENCE_VERSION,
        "reviewText": text,
        "threshold": threshold,
        "topEvidence": top,
        "suspiciousWords": suspicious,
        "measuredSignals": measured,
        "explanationSummary": summary,
        "limitations": limitations,
        "attribution": attribution,
    }


def unresolved_stubs() -> list:
    """Stub names that must be replaced before the service can predict."""
    return integration_stubs()
