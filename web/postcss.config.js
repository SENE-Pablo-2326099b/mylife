import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default {
  plugins: { tailwindcss: { config: join(dirname(fileURLToPath(import.meta.url)), 'tailwind.config.js') }, autoprefixer: {} },
};
