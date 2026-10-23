import type { Palette } from './ui/theme';

/**
 * L'image du Wrapped, dessinée sur l'appareil (rien n'est envoyé) au format d'une story (1080 × 1920),
 * aux couleurs du thème choisi. Que des nombres : jamais de montant ni de nom de compte.
 */
export interface WrappedImage {
  title: string;
  subtitle: string;
  blocks: { value: string; label: string }[];
  level: string;
  footer: string;
}

const W = 1080;
const H = 1920;

function font(weight: number, size: number, family: string) {
  return `${weight} ${size}px ${family}`;
}

/** Coupe un texte trop long pour sa largeur (un seul niveau de repli : « … »). */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Une couleur du thème (#hex, rgb(), rgba()…) avec une opacité donnée (multipliée par la sienne). */
function alpha(ctx: CanvasRenderingContext2D, color: string, a: number): string {
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  const c = String(ctx.fillStyle);
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return color;
  const [r, g, b, own = '1'] = m[1]!.split(',').map((x) => x.trim());
  return `rgba(${r}, ${g}, ${b}, ${Number(own) * a})`;
}

/** Le plus grand corps (≤ `size`, ≥ `min`) où le texte tient sur la largeur. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, min: number, family: string, max: number): number {
  let s = size;
  ctx.font = font(weight, s, family);
  while (s > min && ctx.measureText(text).width > max) {
    s -= 4;
    ctx.font = font(weight, s, family);
  }
  return s;
}

/** Un texte sur au plus deux lignes (coupé aux espaces), le reste en « … ». */
function twoLines(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  if (ctx.measureText(text).width <= max) return [text];
  const words = text.split(' ');
  let first = '';
  while (words.length && ctx.measureText(first ? `${first} ${words[0]}` : words[0]!).width <= max) first = first ? `${first} ${words.shift()}` : words.shift()!;
  if (!first) return [fit(ctx, text, max)];
  return [first, fit(ctx, words.join(' '), max)];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function drawWrapped(data: WrappedImage, t: Palette): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Dessin impossible sur cet appareil.');
  await document.fonts?.ready;
  const css = getComputedStyle(document.documentElement);
  const display = css.getPropertyValue('--font-display').trim() || 'system-ui, sans-serif';
  const body = css.getPropertyValue('--font-body').trim() || 'system-ui, sans-serif';

  // Fond : le champ du thème, et deux halos (accent, or).
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, t.field[0]);
  bg.addColorStop(0.55, t.field[1]);
  bg.addColorStop(1, t.field[2]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, r, color] of [
    [W * 0.15, H * 0.12, 700, t.accentGradient[0]],
    [W * 0.95, H * 0.78, 760, t.gold],
  ] as const) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, alpha(ctx, color, 0.4));
    g.addColorStop(1, alpha(ctx, color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const left = 96;
  const width = W - left * 2;
  ctx.textBaseline = 'alphabetic';

  // En-tête
  ctx.fillStyle = t.gold;
  ctx.font = font(700, 34, body);
  ctx.fillText('MYLIFE · WRAPPED', left, 210);
  ctx.fillStyle = t.text;
  fitSize(ctx, data.title, 800, 120, 72, display, width);
  ctx.fillText(fit(ctx, data.title, width), left, 360);
  ctx.fillStyle = t.textSecondary;
  ctx.font = font(500, 44, body);
  ctx.fillText(fit(ctx, data.subtitle, width), left, 440);

  // Les chiffres : jusqu'à 4 blocs en grille 2 × 2.
  const gap = 36;
  const bw = (width - gap) / 2;
  const bh = 330;
  data.blocks.slice(0, 4).forEach((b, i) => {
    const x = left + (i % 2) * (bw + gap);
    const y = 540 + Math.floor(i / 2) * (bh + gap);
    roundRect(ctx, x, y, bw, bh, 44);
    ctx.fillStyle = alpha(ctx, t.scheme === 'dark' ? '#000000' : '#ffffff', 0.28);
    ctx.fill();
    ctx.strokeStyle = alpha(ctx, t.text, 0.14);
    ctx.lineWidth = 2;
    ctx.stroke();
    const num = ctx.createLinearGradient(x, y, x + bw, y + bh);
    num.addColorStop(0, t.accentGradient[0]);
    num.addColorStop(1, t.gold);
    ctx.fillStyle = num;
    ctx.font = font(800, 120, display);
    ctx.fillText(fit(ctx, b.value, bw - 64), x + 40, y + 170);
    ctx.fillStyle = t.textSecondary;
    ctx.font = font(600, 36, body);
    twoLines(ctx, b.label, bw - 72).forEach((line, k) => ctx.fillText(line, x + 40, y + 240 + k * 46));
  });

  // Niveau
  const ly = 540 + 2 * (bh + gap) + 40;
  roundRect(ctx, left, ly, width, 190, 48);
  const band = ctx.createLinearGradient(left, ly, left + width, ly);
  band.addColorStop(0, t.accentGradient[0]);
  band.addColorStop(1, t.accentGradient[1]);
  ctx.fillStyle = band;
  ctx.fill();
  ctx.fillStyle = t.onAccent;
  const ls = fitSize(ctx, data.level, 800, 60, 36, display, width - 96);
  ctx.fillText(fit(ctx, data.level, width - 96), left + 48, ly + 95 + ls / 3);

  // Pied
  ctx.fillStyle = t.textMuted;
  ctx.font = font(500, 34, body);
  ctx.fillText(fit(ctx, data.footer, width), left, H - 140);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image impossible à créer.'))), 'image/png'));
}

/** Partage l'image (feuille de partage du téléphone) ; sinon, la télécharge. */
export async function shareImage(blob: Blob, name: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
