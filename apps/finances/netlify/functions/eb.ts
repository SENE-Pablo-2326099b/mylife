// Fonction Netlify (v2) : POST /api/eb
import { handleBridge, loadBridgeEnv } from '../../server/bridge.js';

export default async (req: Request): Promise<Response> => {
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => (headers[k] = v));
  const out = await handleBridge({ method: req.method, headers, body: await req.text() }, loadBridgeEnv());
  return new Response(JSON.stringify(out.body), { status: out.status, headers: out.headers });
};

export const config = { path: '/api/eb' };
