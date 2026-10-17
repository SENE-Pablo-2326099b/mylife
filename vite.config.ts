import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { enableBankingBridge } from './server/vitePlugin';

export default defineConfig(({ mode }) => {
  // Variables sans préfixe VITE_ : elles restent côté serveur et ne sont jamais injectées dans le bundle.
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') };
  return {
    plugins: [react(), enableBankingBridge(env)],
  };
});
