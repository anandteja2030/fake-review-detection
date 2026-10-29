import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import { createApiRouter } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {object}  [opts]
 * @param {string}  [opts.staticDir]      Built frontend directory (frontend/dist).
 * @param {string}  [opts.allowedOrigins] Comma-separated CORS allowlist (env ALLOWED_ORIGINS).
 *                                        Default: all origins (public, read-mostly demo API).
 */
export function createApp(opts = {}) {
  const staticDir = opts.staticDir || path.resolve(__dirname, '../../frontend/dist');
  const allowedOrigins = (opts.allowedOrigins ?? process.env.ALLOWED_ORIGINS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const app = express();
  app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : {}));
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createApiRouter());

  // Production single-service mode: when a built frontend exists, serve it from
  // this origin with an SPA fallback. API 404s stay JSON (handled inside /api).
  if (fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: 'index.html', maxAge: '1h', fallthrough: true }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `Unknown route: ${req.method} ${req.originalUrl}. API is served under /api.` });
  });
  return app;
}
