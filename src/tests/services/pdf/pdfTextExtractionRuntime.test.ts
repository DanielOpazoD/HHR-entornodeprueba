import { describe, expect, it } from 'vitest';
import { groupPdfTextItemsIntoLines } from '@/services/pdf/pdfTextExtractionRuntime';

const item = (str: string, x: number, y: number) => ({
  str,
  transform: [1, 0, 0, 1, x, y],
});

describe('pdfTextExtractionRuntime', () => {
  it('applies the page viewport before grouping a report rotated 90 degrees', () => {
    const items = [
      item('08/07/2026 14:19:46', 450, 80),
      item('Habitacion 1', 450, 300),
      item('H1C2', 450, 500),
      item('12/07/2026 18:32:23', 500, 80),
      item('Habitacion 6', 500, 300),
      item('H6C2', 500, 500),
    ];

    expect(groupPdfTextItemsIntoLines(items, [0, 1, 1, 0, 0, 0])).toEqual([
      '08/07/2026 14:19:46 Habitacion 1 H1C2',
      '12/07/2026 18:32:23 Habitacion 6 H6C2',
    ]);
  });
});
