import { describe, expect, it } from 'vitest';
import { buildLabPdfFilename } from '@/services/laboratory/labPdfFilenameController';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';

const exam = (date: string, patientName = 'María José Pérez Soto'): SyslabExamItem => ({
  id: date,
  link: `https://syslab.test/${date}`,
  date,
  time: '08:30',
  patientName,
  origin: 'HHR',
  exams: ['Hemograma'],
});

describe('laboratory PDF filename', () => {
  it('uses a single normalized date, patient name and RUT', () => {
    expect(buildLabPdfFilename([exam('24/08/2026')], '14.125.562-2')).toBe(
      'Laboratorio HHR 24-08-2026, María José Pérez Soto, 14.125.562-2.pdf'
    );
  });

  it('uses the chronological range for a multi-report summary', () => {
    expect(buildLabPdfFilename([exam('24-08-2026'), exam('2026-08-17')], '14.125.562-2')).toBe(
      'Laboratorio HHR 17-08-2026 a 24-08-2026, María José Pérez Soto, 14.125.562-2.pdf'
    );
  });

  it('sanitizes path separators without removing accents or identifiers', () => {
    expect(buildLabPdfFilename([exam('24/08/2026', 'Ana / Pérez')], '12/34')).toBe(
      'Laboratorio HHR 24-08-2026, Ana - Pérez, 12-34.pdf'
    );
  });
});
