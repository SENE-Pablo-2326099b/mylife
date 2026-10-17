import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleBridge, readRawBody, type BridgeEnv } from './bridge.js';

/** Adaptateur Node (http.IncomingMessage) : utilisé par Vercel et par le serveur Vite. */
export async function nodeBridgeHandler(req: IncomingMessage & { body?: unknown }, res: ServerResponse, env: BridgeEnv): Promise<void> {
  let body: unknown = req.body;
  if (body === undefined) {
    try {
      body = await readRawBody(req);
    } catch {
      res.statusCode = 413;
      res.end(JSON.stringify({ error: 'Requête trop volumineuse' }));
      return;
    }
  }
  try {
    const out = await handleBridge({ method: req.method ?? 'GET', headers: req.headers, body }, env);
    res.statusCode = out.status;
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    res.end(JSON.stringify(out.body));
  } catch {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Erreur interne du relais.' }));
  }
}
