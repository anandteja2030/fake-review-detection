import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METRICS_FILE = path.join(__dirname, '..', 'data', 'model_metrics.json');

const REQUIRED_KEYS = ['accuracy', 'precision', 'recall', 'f1Score', 'rocAuc', 'confusionMatrix'];

export function loadModelMetrics() {
  const raw = JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
  for (const key of REQUIRED_KEYS) {
    if (raw[key] === undefined) throw Object.assign(new Error(`model_metrics.json missing key: ${key}`), { status: 500, code: 'METRICS_FILE_INVALID' });
  }
  return raw;
}
