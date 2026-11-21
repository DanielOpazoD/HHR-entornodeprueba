// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildLabPdfFilename } from '@/services/laboratory/labPdfFilenameController';
import type { SyslabExamItem } from '@/types/domain/labExamTypes';

const exam = (date: string, patientName = 'Mopéf José Pérez Soto'): SyslabExamItem => ({
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
    expect(buildLabPdfFilename([exam('24/08/2026')], '10.000.115-2')).toBe(
      'Laboratorio HHR 24-08-2026, Mopéf José Pérez Soto, 10.000.115-2.pdf'
    );
  });

  it('uses the chronological range for a multi-report summary', () => {
    expect(buildLabPdfFilename([exam('24-08-2026'), exam('2026-08-17')], '10.000.115-2')).toBe(
      'Laboratorio HHR 17-08-2026 a 24-08-2026, Mopéf José Pérez Soto, 10.000.115-2.pdf'
    );
  });

  it('sanitizes path separators without removing accents or identifiers', () => {
    expect(buildLabPdfFilename([exam('24/08/2026', 'Ana / Pérez')], '12/34')).toBe(
      'Laboratorio HHR 24-08-2026, Ana - Pérez, 12-34.pdf'
    );
  });
});
