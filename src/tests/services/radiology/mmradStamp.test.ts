import { describe, expect, it } from 'vitest';
import {
  formatMmradStamp,
  mmradStampSortKey,
  parseMmradStamp,
  sortByMmradStampDesc,
} from '@/services/radiology/mmradStamp';

describe('mmradStamp', () => {
  it('reads day, month, year and the optional time, with slashes, dots or dashes', () => {
    expect(parseMmradStamp('10/04/2026 09:00')).toEqual({ day: '10', month: '04', year: '2026', hours: '09', minutes: '00' });
    expect(parseMmradStamp('01.11.2026')).toEqual({ day: '01', month: '11', year: '2026', hours: null, minutes: null });
    expect(parseMmradStamp('24-10-2026 11:30')).toMatchObject({ day: '24', month: '10' });
    expect(parseMmradStamp('')).toBeNull();
    expect(parseMmradStamp('sin fecha')).toBeNull();
  });

  it('orders newest first by the stamp itself, so a time never hides the day and month', () => {
    const exams = [
      { nombre: 'a', fecha_examen: '10/04/2026 09:00' },
      { nombre: 'b', fecha_examen: '01/03/2026 18:00' },
      { nombre: 'c', fecha_examen: '12/04/2026 07:00' },
      { nombre: 'd', fecha_examen: '12/04/2026' },
      { nombre: 'e', fecha_examen: '' },
    ];
    expect(sortByMmradStampDesc(exams).map(exam => exam.nombre)).toEqual(['c', 'd', 'a', 'b', 'e']);
    expect(exams[0].nombre).toBe('a');
    expect(mmradStampSortKey('12/04/2026')).toBe('2026-04-12 00:00');
  });

  it('writes the stamp as the app writes dates', () => {
    expect(formatMmradStamp('02/11/2026 09:40')).toBe('02-11-2026 09:40');
    expect(formatMmradStamp('24.10.2026')).toBe('24-10-2026');
    expect(formatMmradStamp('pendiente')).toBe('pendiente');
  });
});
