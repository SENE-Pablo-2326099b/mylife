import { describe, expect, it } from 'vitest';
import { decimalToCents, divideCents, formatCents, percent, tryDecimalToCents, centsToInput } from '../src/lib/money';

describe('decimalToCents', () => {
  it.each([
    ['12.50', 1250],
    ['12,50', 1250],
    ['12,5', 1250],
    ['-3', -300],
    ['−4,20', -420],
    ['+0,05', 5],
    ['1 234,56', 123456],
    ['1 537,00 €', 153700],
    ['1.234,56', 123456],
    ['1,234.56', 123456],
    ['1.234.567', 123456700],
    ['0.1', 10],
    ['0.105', 11],
    ['0.104', 10],
    ['12.30-', -1230],
    ['.5', 50],
  ])('%s → %i', (input, expected) => {
    expect(decimalToCents(input)).toBe(expected);
  });

  it('évite les erreurs de flottant', () => {
    expect(decimalToCents('0.1') + decimalToCents('0.2')).toBe(30);
    expect(decimalToCents('19.99')).toBe(1999);
  });

  it('rejette les saisies invalides', () => {
    expect(() => decimalToCents('abc')).toThrow();
    expect(() => decimalToCents('')).toThrow();
    expect(tryDecimalToCents('12a')).toBeNull();
  });
});

describe('formatCents', () => {
  it('formate à la française', () => {
    expect(formatCents(153700)).toBe('1 537,00 €');
    expect(formatCents(-420)).toBe('−4,20 €');
    expect(formatCents(500, { sign: true })).toBe('+5,00 €');
    expect(formatCents(89800, { compact: true })).toBe('898 €');
    expect(formatCents(5)).toBe('0,05 €');
  });
  it('centsToInput', () => {
    expect(centsToInput(153700)).toBe('1537');
    expect(centsToInput(1250)).toBe('12,50');
  });
});

describe('divideCents / percent', () => {
  it('arrondit vers le bas', () => {
    expect(divideCents(1000, 3)).toBe(333);
    expect(divideCents(-1000, 3)).toBe(-334);
    expect(divideCents(1000, 0)).toBe(1000);
  });
  it('percent', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(5, 0)).toBe(0);
  });
});
