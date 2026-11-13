import { pathToFileURL } from 'url';
import { createApp } from './app.js';
import { modelStatus } from './mlAdapter.js';
import { startSupervisor, supervisorStatus } from './mlSupervisor.js';

export function startServer(port = process.env.PORT || 4000) {
  const app = createApp();
  const server = app.listen(port, () => {
    const status = modelStatus();
    console.log(`[api] Explainable Fake Review Detection API listening on port ${server.address().port}`);
    console.log(`[api] ML adapter mode: ${status.adapterMode} | model connected: ${status.connected}`);
    if (status.connected) {
      startSupervisor();
      const sup = supervisorStatus();
      if (sup.remote) {
        // Hosted engine (e.g. Render): started and restarted by the platform,
        // never by this process. No Python is spawned for a remote URL.
        console.log(`[api] ML service is remote (${status.serviceUrl}) — local engine spawning disabled.`);
        console.log(`[api] ML request timeout ${status.timeoutMs}ms per attempt, retries ${status.maxRetries}`);
      } else {
        // Local development: own the engine lifecycle (start it, restart it).
        console.log(`[api] ML supervisor active (python: ${sup.python || 'not found'}, logs: ${sup.logFile})`);
      }
    } else {
      console.log('[api] /api/analyze will return status=model_not_connected (no predictions until the Python service is integrated).');
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
