"""
Feature pipeline for the Fake Review Detection inference service.

Every step below is recovered from the AUTHORITATIVE original training code
provided by the project owner:

    1. Text cleaning              -> clean_text()              (verbatim)
    2. Word-level TF-IDF          -> word_tfidf()              (SAVED vectorizer, never fitted)
    3. Character-level TF-IDF     -> char_tfidf()              (SAVED vectorizer, never fitted)
    4. Sentence-BERT embedding    -> sbert_embedding()         (all-MiniLM-L6-v2, normalized)
    5. Manual linguistic features -> manual_features()         (original formulas/keywords)
    6. Semantic similarity        -> semantic_similarity()     (original formula)
    7. Final feature assembly     -> assemble_feature_vector() (original hstack orders)

CLASS SEMANTICS (original training code): 0 = Genuine, 1 = Fake.
The trained model is BINARY - there is no trained "Suspicious" class.

No integration stubs remain in this module: everything above was recoverable
from the authoritative training code. The @integration_stub mechanism is
retained only so serve.py's readiness check keeps working unchanged.

Text-source convention: the pipeline's step 1 is text cleaning, so all
content-derived features (sentiment, promo matching, word statistics, TF-IDF
input, SBERT input) are computed from the CLEANED text; char_length is
explicitly defined on the ORIGINAL text by the training spec.
"""

import functools
import re
import sys

import numpy as np
from scipy.sparse import csr_matrix, hstack
from sklearn.metrics.pairwise import cosine_similarity


# ---------------------------------------------------------------------------
# Integration-stub machinery (kept for serve.py's readiness check; currently
# no function in this module is a stub)
# ---------------------------------------------------------------------------
def integration_stub(fn):
    """Marker decorator: the function body is NOT the original implementation."""
    fn.__integration_stub__ = True

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        raise NotImplementedError(
            f"{fn.__name__}: integration stub - paste the ORIGINAL "
            f"implementation from your Fake Review Detection project here."
        )
    wrapper.__integration_stub__ = True
    return wrapper


def integration_stubs() -> list:
    """Names of functions in this module still running as integration stubs."""
    module = sys.modules[__name__]
    return sorted(
        name for name, obj in vars(module).items()
        if getattr(obj, "__integration_stub__", False)
    )


# ---------------------------------------------------------------------------
# 1. Text cleaning - AUTHORITATIVE (verbatim from the original training code)
# ---------------------------------------------------------------------------
def clean_text(text) -> str:
    """Original training-code text cleaning, copied exactly (no changes)."""
    text = str(text)
    text = re.sub(r"http\S+|www\.\S+", " ", text)
    text = re.sub(r"<.*?>", " ", text)
    text = re.sub(r"[^a-zA-Z0-9\s!?']", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


# ---------------------------------------------------------------------------
# 2. Word-level TF-IDF - uses the FITTED artifact; never (re)fitted here
# ---------------------------------------------------------------------------
def word_tfidf(word_vectorizer, cleaned_text: str):
    """Transform cleaned text with the TRAINED word TF-IDF vectorizer."""
    return word_vectorizer.transform([cleaned_text])


# ---------------------------------------------------------------------------
# 3. Character-level TF-IDF - uses the FITTED artifact; never (re)fitted here
# ---------------------------------------------------------------------------
def char_tfidf(char_vectorizer, cleaned_text: str):
    """Transform cleaned text with the TRAINED char TF-IDF vectorizer."""
    return char_vectorizer.transform([cleaned_text])


# ---------------------------------------------------------------------------
# 4. Sentence-BERT embedding - encoder loaded ONCE at startup
# ---------------------------------------------------------------------------
def sbert_embedding(embedder, cleaned_text: str) -> np.ndarray:
    """Encode cleaned text with the pre-loaded all-MiniLM-L6-v2 encoder,
    using normalize_embeddings=True exactly as in the training pipeline."""
    encoded = embedder.encode([cleaned_text], normalize_embeddings=True)
    return np.asarray(encoded, dtype=np.float64)


# ---------------------------------------------------------------------------
# VADER sentiment analyzer - created ONCE (startup warmup), not per request
# ---------------------------------------------------------------------------
_VADER_ANALYZER = None


def _vader():
    global _VADER_ANALYZER
    if _VADER_ANALYZER is None:
        from nltk.sentiment.vader import SentimentIntensityAnalyzer
        try:
            _VADER_ANALYZER = SentimentIntensityAnalyzer()
        except LookupError:
            # First run in a fresh environment: fetch the small vader_lexicon.
            import nltk
            nltk.download("vader_lexicon", quiet=True)
            _VADER_ANALYZER = SentimentIntensityAnalyzer()
    return _VADER_ANALYZER


def warmup() -> None:
    """Fail fast at startup if the VADER lexicon is unavailable."""
    _vader()


# ---------------------------------------------------------------------------
# 5. Manual linguistic / style features - AUTHORITATIVE formulas
# ---------------------------------------------------------------------------
PROMO_KEYWORDS = (
    "buy", "shop", "discount", "sale", "offer", "limited time", "exclusive",
    "save", "free", "bonus", "deal", "promo", "coupon", "bargain",
    "great value", "get yours now", "order now", "amazing", "perfect",
    "best", "excellent", "fantastic", "must buy", "highly recommended",
)

# Exact feature names and order from the original training code:
#   review_length, char_length, repetition_ratio, sentiment, promo_score,
#   rating_sent_gap, avg_word_length, short_flag, sim_score
DOCUMENTED_MANUAL_FEATURES = [
    "review_length",
    "char_length",
    "repetition_ratio",
    "sentiment",
    "promo_score",
    "rating_sent_gap",
    "avg_word_length",
    "short_flag",
    "sim_score",
]


def manual_features(text, rating, cleaned_text: str, sim_score: float) -> dict:
    """Compute the 9 handcrafted features with the ORIGINAL formulas.

    Returns a dict keyed by the exact feature names above:

      review_length    = cleaned-text word count
      char_length      = original text length
      repetition_ratio = repeated word occurrences / total words
                         (occurrences beyond the first occurrence of each word)
      sentiment        = VADER compound score (cleaned text)
      promo_score      = number of promotional keywords matched (cleaned text)
      rating_sent_gap  = abs(rating - ((sentiment + 1) * 2.5))
      avg_word_length  = average word length
      short_flag       = 1 when word count < 5, else 0
      sim_score        = semantic similarity (computed by semantic_similarity)

    The vector built from this dict is ordered by manual_feature_columns.pkl
    in order_manual_features(), because feature_scaler.pkl was fitted on that
    saved order.
    """
    words = cleaned_text.split()
    total_words = len(words)

    review_length = total_words                                  # cleaned-text word count
    char_length = len(text)                                      # original text length
    repetition_ratio = ((total_words - len(set(words))) / total_words) if total_words else 0.0
    sentiment = float(_vader().polarity_scores(cleaned_text)["compound"])
    promo_score = float(sum(1 for keyword in PROMO_KEYWORDS if keyword in cleaned_text))
    rating_sent_gap = abs(float(rating) - ((sentiment + 1.0) * 2.5))
    avg_word_length = (sum(len(w) for w in words) / total_words) if total_words else 0.0
    short_flag = 1 if total_words < 5 else 0

    return {
        "review_length": float(review_length),
        "char_length": float(char_length),
        "repetition_ratio": float(repetition_ratio),
        "sentiment": sentiment,
        "promo_score": promo_score,
        "rating_sent_gap": float(rating_sent_gap),
        "avg_word_length": float(avg_word_length),
        "short_flag": float(short_flag),
        "sim_score": float(sim_score),
    }


def validate_manual_columns(manual_feature_columns) -> list:
    """Validate manual_feature_columns.pkl against the authoritative feature
    set and return the SAVED column names (the scaler's fitted order)."""
    try:
        columns = [str(c) for c in list(manual_feature_columns)]
    except TypeError as exc:
        raise ValueError(
            f"manual_feature_columns.pkl is not an iterable of column names: {exc}"
        ) from exc
    if not columns:
        raise ValueError("manual_feature_columns.pkl is empty")
    if len(columns) != len(set(columns)):
        raise ValueError(f"manual_feature_columns.pkl contains duplicates: {columns}")
    known = set(DOCUMENTED_MANUAL_FEATURES)
    got = set(columns)
    if got != known:
        raise ValueError(
            "manual_feature_columns.pkl does not match the authoritative feature set; "
            f"missing={sorted(known - got)}, unexpected={sorted(got - known)}"
        )
    return columns


def order_manual_features(feature_values: dict, manual_feature_columns) -> np.ndarray:
    """Build the 9-feature row in the SAVED column order (scaler-fitted)."""
    columns = validate_manual_columns(manual_feature_columns)
    row = []
    for col in columns:
        if col not in feature_values:
            raise ValueError(f"missing manual feature value: {col}")
        row.append(float(feature_values[col]))
    return np.array([row], dtype=np.float64)


# ---------------------------------------------------------------------------
# 6. Semantic similarity - AUTHORITATIVE formula
# ---------------------------------------------------------------------------
def semantic_similarity(embedding: np.ndarray, reference_embeddings: np.ndarray) -> float:
    """Original training formula:

        cosine_similarity(embedding, reference_embeddings).max()
    """
    if getattr(reference_embeddings, "ndim", None) != 2:
        raise ValueError(
            f"reference_embeddings.npy must be 2-D, got shape "
            f"{getattr(reference_embeddings, 'shape', None)}"
        )
    return float(cosine_similarity(embedding, reference_embeddings).max())


# ---------------------------------------------------------------------------
# 7. Final feature assembly - AUTHORITATIVE concatenation orders
# ---------------------------------------------------------------------------
def assemble_feature_vector(feature_values: dict, manual_feature_columns,
                            scaler, word_matrix, char_matrix, sbert_vec):
    """Order -> scale -> concatenate, exactly as in the training code.

    Step 6 (spec): order the manual features per manual_feature_columns.pkl,
    then apply scaler.transform(manual_features) - NEVER fit.

    Step 7 - final SPARSE features for Logistic Regression:

        hstack([word_tfidf, char_tfidf, csr_matrix(bert_embedding),
                csr_matrix(manual_features_scaled)]).tocsr()

    Step 8 - final DENSE features for XGBoost and LightGBM:

        np.hstack([bert_embedding, manual_features_scaled])

    Returns (X_sparse, X_dense), one row each.
    """
    manual_vec = order_manual_features(feature_values, manual_feature_columns)
    manual_scaled = np.asarray(scaler.transform(manual_vec), dtype=np.float64).reshape(1, -1)

    # Step 7: exact training order for Logistic Regression (sparse)
    X_sparse = hstack([
        word_matrix,
        char_matrix,
        csr_matrix(sbert_vec),
        csr_matrix(manual_scaled),
    ]).tocsr()

    # Step 8: exact training order for XGBoost / LightGBM (dense)
    X_dense = np.hstack([
        np.asarray(sbert_vec, dtype=np.float64),
        manual_scaled,
    ])

    return X_sparse, X_dense
