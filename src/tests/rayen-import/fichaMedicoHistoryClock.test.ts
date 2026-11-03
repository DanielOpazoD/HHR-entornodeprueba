import { describe, expect, it } from 'vitest';

import {
  fichaMedicoActivityStampInRapaNui,
  fichaMedicoHistoryStampInRapaNui,
} from '@/features/rayen-import/mapping/fichaMedicoHistoryClock';

describe('Ficha Médico history times, read on the hospital clock', () => {
  it.each([
    ['summer time (mainland UTC-3, Rapa Nui UTC-5)', '2026-11-02T10:15:00', '2026-11-02T08:15:00'],
    [
      'winter time (mainland UTC-4, Rapa Nui UTC-6)',
      '2026-07-13T07:30:00.123',
      '2026-07-13T05:30:00',
    ],
    ['a stamp written with a space', '2026-11-02 21:05', '2026-11-02T19:05:00'],
    [
      'early morning, which still belongs to the previous Rapa Nui day',
      '2026-10-15T01:20:00',
      '2026-10-14T23:20:00',
    ],
    [
      'the night summer time began (mainland 01:30 after the jump)',
      '2026-09-06T01:30:00',
      '2026-09-05T23:30:00',
    ],
  ])('converts %s', (_case, raw, rapaNui) => {
    expect(fichaMedicoHistoryStampInRapaNui(raw)).toBe(rapaNui);
  });

  it('converts a value that carries its own offset from its instant', () => {
    expect(fichaMedicoHistoryStampInRapaNui('2026-11-02T10:15:00-03:00')).toBe(
      '2026-11-02T08:15:00'
    );
  });

  it.each(['', 'sin fecha', '2026-02-30T10:00:00', '2026-11-02T25:00:00'])(
    'refuses %j instead of guessing',
    raw => {
      expect(fichaMedicoHistoryStampInRapaNui(raw)).toBeNull();
    }
  );

  it('leaves vital signs, which Ficha Médico already writes in Rapa Nui time, unchanged', () => {
    expect(fichaMedicoActivityStampInRapaNui('2026-11-02T09:10:00', 'vital-signs')).toBe(
      '2026-11-02T09:10:00'
    );
    expect(fichaMedicoActivityStampInRapaNui('2026-11-02T09:10:00', 'evolution')).toBe(
      '2026-11-02T07:10:00'
    );
  });
});
