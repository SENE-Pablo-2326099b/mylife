/** 12 345,60 € ; sans centimes quand le montant est rond ou que `round` est demandé. */
export function euros(cents: number, opts: { round?: boolean; sign?: boolean } = {}): string {
  const whole = opts.round || cents % 100 === 0;
  const text = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(Math.abs(cents) / 100);
  return (cents < 0 ? '−' : opts.sign && cents > 0 ? '+' : '') + text;
}
