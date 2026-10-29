/** Serializes an analysis result into the public API shape (single + batch). */
export function serializeAnalysis(result) {
  return {
    success: true,
    status: result.status,
    prediction: result.prediction ?? null,
    message: result.message ?? null,
    features: result.features ?? null,
    ratingSentimentGap: result.ratingSentimentGap ?? null,
    semanticSimilarity: result.semanticSimilarity ?? null,
    clarifyingSignals: result.clarifyingSignals ?? null,
    probabilities: result.probabilities ?? null,
    trustScore: result.trustScore ?? null,
    riskLevel: result.riskLevel ?? null,
    confidence: result.confidence ?? null,
    evidence: result.evidence ?? null,
    model: result.model ?? null,
    text: result.text ?? null,
    productName: result.productName ?? null,
    productCategory: result.productCategory ?? null,
    rating: result.rating ?? null,
    analyzedAt: result.analyzedAt,
    requestTimeMs: result.requestTimeMs
  };
}
