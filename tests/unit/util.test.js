import { describe, it, expect } from 'vitest';
import { cleanCode, randomCode, fmtTime } from '../../src/util.js';

describe('códigos de sala', () => {
  it.each([
    ['ABCDE', 'ABCDE'],
    ['abcde', 'ABCDE'],
    ['  ab cde  ', 'ABCDE'],
    ['https://didacmaymo.github.io/pium-pium-game/#XY7KQ', 'XY7KQ'],
    ['#xy7kq', 'XY7KQ'],
    ['AB-CD', 'ABCD'],
    ['', ''],
    [null, ''],
  ])('cleanCode(%j) = %j', (raw, out) => expect(cleanCode(raw)).toBe(out));

  it('randomCode no usa caracteres confusos', () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
      expect(cleanCode(c)).toBe(c);
    }
  });
});

describe('fmtTime', () => {
  it.each([[0, '0:00.00'], [5.5, '0:05.50'], [83.456, '1:23.46'], [-3, '0:00.00']])('%d s -> %s', (s, out) => {
    expect(fmtTime(s)).toBe(out);
  });
});
