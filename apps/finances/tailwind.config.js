import lumen from './src/ui/tailwind.preset.js';

/** Jetons et typographie : le préréglage commun des apps web MyLife (src/ui/tailwind.preset.js). */
export default {
  presets: [lumen],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
};
