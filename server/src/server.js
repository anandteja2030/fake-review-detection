import { pathToFileURL } from 'url';
import { createApp } from './app.js';
import { modelStatus } from './mlAdapter.js';

export function startServer(port = process.env.PORT || 4000) {
  const app = createApp();
  const server = app.listen(port, () => {
    const status = modelStatus();
    console.log(`[api] Explainable Fake Review Detection API listening on port ${server.address().port}`);
    console.log(`[api] ML adapter mode: ${status.adapterMode} | model connected: ${status.connected}`);
    if (!status.connected) console.log('[api] /api/analyze will return status=model_not_connected (no predictions until the Python service is integrated).');
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
