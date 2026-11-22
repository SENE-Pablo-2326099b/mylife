/** Convertit un montant décimal texte ("12.50", "-3", "1 234,56", "+0,5") en centimes. */
export function decimalToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Montant invalide : ${input}`);
    if (Number.isInteger(input) && Number.isSafeInteger(input * 100)) return input * 100;
    input = input.toFixed(2);
  }
  let s = input.trim().replace(/[\s\u00a0\u202f€]/g, '');
  if (s === '') throw new Error(`Montant vide`);
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart = s;
  let fracPart = '';
  if (lastComma !== -1 && lastDot !== -1) {
    // Les deux sont présents : le dernier est le séparateur décimal.
    const dec = Math.max(lastComma, lastDot);
    intPart = s.slice(0, dec);
    fracPart = s.slice(dec + 1);
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.';
    const parts = s.split(sep);
    if (parts.length > 2) {
      intPart = parts.join(''); // "1.234.567" : séparateurs de milliers
    } else {
      intPart = parts[0] ?? '';
      fracPart = parts[1] ?? '';
    }
  }
  intPart = intPart.replace(/[.,']/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || (intPart === '' && fracPart === '')) {
    throw new Error(`Montant invalide : "${input}"`);
  }
  const euros = intPart === '' ? 0 : parseInt(intPart, 10);
  let cents: number;
  if (fracPart.length <= 2) {
    cents = parseInt(fracPart.padEnd(2, '0') || '0', 10);
  } else {
    // arrondi au centime le plus proche (demi vers le haut)
    const firstTwo = parseInt(fracPart.slice(0, 2), 10);
    cents = firstTwo + (parseInt(fracPart.charAt(2), 10) >= 5 ? 1 : 0);
  }
  const total = euros * 100 + cents;
  if (!Number.isSafeInteger(total)) throw new Error(`Montant trop grand : "${input}"`);
  return negative ? -total : total;
}
