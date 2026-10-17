import type { Plugin } from 'vite';
import { loadBridgeEnv } from './bridge.js';
import { nodeBridgeHandler } from './node.js';

/** Monte le relais Enable Banking sur /api/eb pendant `vite dev` et `vite preview`. */
export function enableBankingBridge(envSource: Record<string, string | undefined>): Plugin {
  const env = loadBridgeEnv(envSource);
  const mount = (middlewares: { use: (path: string, fn: (req: never, res: never) => void) => void }) => {
    middlewares.use('/api/eb', (req, res) => {
      void nodeBridgeHandler(req, res, env);
    });
  };
  return {
    name: 'enable-banking-bridge',
    configureServer(server) {
      mount(server.middlewares as never);
    },
    configurePreviewServer(server) {
      mount(server.middlewares as never);
    },
  };
}
