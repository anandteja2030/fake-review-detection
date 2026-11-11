import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { useFetch } from '../hooks/useModels.js';
import ProbBars from './charts/ProbBars.jsx';
import Banner from './ui/Banner.jsx';
import { adoptSavedAnalysis } from '../lib/adoptAnalysis.js';
import { IconSpark, IconArrowRight } from './layout/Icons.jsx';

const TEXT_MAX = 6000;

/**
 * Quick single-review analysis on the dashboard.
 * Runs the SAME /api/analyze endpoint as the analyzer — no mock data, no
 * client-side scoring. The result shown is exactly what the model returned.
 */
export default function QuickAnalysis({ connected }) {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [rating, setRating] = useState(null);
  const [category, setCategory] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const { data: catData } = useFetch(() => api.categories());

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!text.trim()) { setFieldError('Enter a review to analyze.'); return; }
    if (rating === null) { setFieldError('Choose a star rating — the rating is a model input signal.'); return; }
    setFieldError(null);
    setRunning(true);
    try {
      const meta = category ? { productCategory: category } : {};
      const data = await api.analyze(text.trim(), rating, meta);
      setResult(data);
    } catch (err) {
      setError(err);
    } finally {
      setRunning(false);
    }
  }

  async function openEvidence() {
    if (!result) return;
    if (await adoptSavedAnalysis(result, { source: 'dashboard' })) navigate('/explainability');
  }

  function reset() {
    setText('');
    setRating(null);
    setResult(null);
    setError(null);
    setFieldError(null);
  }

  const modelConnected = result?.status === 'model_connected';

  return (
    <form className="card quick" onSubmit={submit}>
      <div className="quick-head">
        <div>
          <div className="quick-title">
            <span className="glyph" aria-hidden="true"><IconSpark /></span>
            Quick Review Analysis
          </div>
          <div className="card-sub" style={{ marginBottom: 0, marginTop: 6 }}>
            One review through the full hybrid pipeline — TF-IDF, Sentence-BERT, manual features and the stacking ensemble.
          </div>
        </div>
        <span className="provenance-chip live">Live inference</span>
      </div>

      {!connected && (
        <div style={{ marginBottom: 14 }}>
          <Banner kind="warn">
            <b>ML service offline.</b> Submissions return no prediction until the FastAPI service is running.
            Nothing is fabricated in its place.
          </Banner>
        </div>
      )}

      <div className="quick-grid">
        <div>
          <label className="field-label" htmlFor="quick-review">Review text</label>
          <textarea
            id="quick-review"
            className="textarea"
            style={{ minHeight: 132 }}
            placeholder="Paste a product review — e.g. “Battery life is great but the hinge feels loose after two weeks…”"
            maxLength={TEXT_MAX}
            value={text}
            onChange={(e) => { setText(e.target.value); setFieldError(null); }}
            disabled={running}
          />
          <div className="spread" style={{ marginTop: 4 }}>
            <span className="quick-count">{text.length}/{TEXT_MAX} chars · {words} words</span>
            {fieldError && <span className="field-error" style={{ marginTop: 0 }}>{fieldError}</span>}
          </div>
        </div>

        <div className="quick-side">
          <div>
            <div className="spread" style={{ marginBottom: 5 }}>
              <span className="field-label">Star rating</span>
              <span className="star-readout">{rating ?? '—'} / 5</span>
            </div>
            <div className="star-picker" role="radiogroup" aria-label="Star rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button" key={n} role="radio" aria-checked={rating === n}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`} data-rating={n}
                  className={`star-btn${rating != null && rating >= n ? ' on' : ''}${rating === n ? ' selected' : ''}`}
                  onClick={() => { setRating(n); setFieldError(null); }}
                  disabled={running}
                >★</button>
              ))}
            </div>
            <p className="faint star-note">The rating is part of the feature vector the model sees.</p>
          </div>
          <div>
            <label className="field-label" htmlFor="quick-category">Category <span className="faint">(optional)</span></label>
            <div className="select-wrap">
              <select
                id="quick-category" className="select-input" value={category}
                onChange={(e) => setCategory(e.target.value)} disabled={running}
              >
                <option value="">No category</option>
                {(catData?.categories || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="quick-actions">
        <button type="submit" className="btn btn-primary" disabled={running}>
          {running ? 'Analyzing…' : 'Analyze Review'} {!running && <IconArrowRight />}
        </button>
        {(result || error) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={running}>
            Analyze another
          </button>
        )}
        <span className="quick-count">results are written to prediction history</span>
      </div>

      {running && (
        <div className="quick-result">
          <div className="scan-frame">
            <span className="scan-line" />
            <span className="scan-label">
              <span className="scan-core" aria-hidden="true" />
              tf-idf · sbert · manual features · meta-model
              <span className="scan-steps" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /></span>
            </span>
          </div>
        </div>
      )}

      {error && !running && (
        <div style={{ marginTop: 14 }}>
          <Banner kind="warn"><b>Analysis failed:</b> {error.message}</Banner>
        </div>
      )}

      {result && !running && (
        <div className="quick-result">
          {modelConnected && result.prediction ? (
            <>
              <div className="quick-verdict">
                <div>
                  <div className={`quick-label ${result.prediction}`}>{result.prediction}</div>
                  <div className="faint small">meta-model verdict · threshold applied</div>
                </div>
                <ProbBars probabilities={result.probabilities} />
              </div>
              <div className="quick-mini">
                <div className="cell">
                  <div className="k">Confidence</div>
                  <div className="v">{result.confidence != null ? `${(result.confidence * 100).toFixed(1)}%` : '—'}</div>
                </div>
                <div className="cell">
                  <div className="k">Trust · derived</div>
                  <div className="v">{result.trustScore != null ? `${result.trustScore}/100` : '—'}</div>
                </div>
                <div className="cell">
                  <div className="k">Risk · derived</div>
                  <div className="v">{result.riskLevel ?? '—'}</div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={openEvidence}>
                  Open evidence <IconArrowRight />
                </button>
                <span className="faint small">
                  Saved with its probabilities, signals and evidence — review it any time in Predictions.
                </span>
              </div>
            </>
          ) : (
            <Banner kind="warn">
              {result.message || 'The analysis returned no model output.'} Nothing was fabricated for display.
            </Banner>
          )}
        </div>
      )}
    </form>
  );
}
