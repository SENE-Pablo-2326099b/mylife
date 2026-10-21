/** SVG path through the points as a monotone cubic spline (x must be non-decreasing). */
export function monotonePath(pts: readonly [number, number][]): string {
  const n = pts.length;
  const f = (v: number) => v.toFixed(1);
  if (n === 0) return '';
  const first = pts[0] as [number, number];
  if (n === 1) return `M${f(first[0])},${f(first[1])}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i] as [number, number];
    const [x1, y1] = pts[i + 1] as [number, number];
    dx.push(x1 - x0);
    slope.push(x1 === x0 ? 0 : (y1 - y0) / (x1 - x0));
  }
  // Tangents: 0 at a local extremum (no overshoot), harmonic-style mean elsewhere.
  const m: number[] = pts.map((_, i) => {
    if (i === 0) return slope[0] ?? 0;
    if (i === n - 1) return slope[n - 2] ?? 0;
    const a = slope[i - 1] ?? 0;
    const b = slope[i] ?? 0;
    if (a * b <= 0) return 0;
    const wa = 2 * (dx[i] ?? 0) + (dx[i - 1] ?? 0);
    const wb = (dx[i] ?? 0) + 2 * (dx[i - 1] ?? 0);
    return (wa + wb) / (wa / a + wb / b);
  });
  let d = `M${f(first[0])},${f(first[1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i] as [number, number];
    const [x1, y1] = pts[i + 1] as [number, number];
    const h = (dx[i] ?? 0) / 3;
    if (h === 0) {
      d += ` L${f(x1)},${f(y1)}`;
      continue;
    }
    d += ` C${f(x0 + h)},${f(y0 + (m[i] ?? 0) * h)} ${f(x1 - h)},${f(y1 - (m[i + 1] ?? 0) * h)} ${f(x1)},${f(y1)}`;
  }
  return d;
}
