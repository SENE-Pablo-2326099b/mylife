// Fonction serverless Vercel : POST /api/eb
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadBridgeEnv } from '../server/bridge.js';
import { nodeBridgeHandler } from '../server/node.js';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await nodeBridgeHandler(req, res, loadBridgeEnv());
}
