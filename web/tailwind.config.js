import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import lumen from './src/ui/tailwind.preset.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Jetons et typographie : le préréglage commun des apps web MyLife (src/ui/tailwind.preset.js). */
export default {
  presets: [lumen],
  content: [join(here, 'index.html'), join(here, 'src/**/*.{ts,tsx}')],
};
