import { formatDuration } from '../dates';
import { searchKey } from '../text';

it('searches without accents or case', () => {
  expect(searchKey('Développé militaire')).toBe('developpe militaire');
  expect(searchKey('Élévations latérales')).toContain('elevations laterales');
});


it('formats session durations, including sessions left open for days', () => {
  expect(formatDuration(42 * 60_000)).toBe('42 min');
  expect(formatDuration(75 * 60_000)).toBe('1h15');
  expect(formatDuration((52 * 60 + 13) * 60_000)).toBe('2 j 4 h');
});
