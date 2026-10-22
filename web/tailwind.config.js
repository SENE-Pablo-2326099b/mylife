import lumen from './src/ui/tailwind.preset.js';

/** Jetons et typographie : le préréglage commun des apps web MyLife (src/ui/tailwind.preset.js). */
export default {
  presets: [lumen],
  content: [new URL('./index.html', import.meta.url).pathname, new URL('./src/**/*.{ts,tsx}', import.meta.url).pathname],
};
