// @vitest-environment jsdom
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import '../../../extension/epicrisis-pdf.js';

describe('epicrisis PDF extension', () => {
  it('inserts a dedicated recipe page without changing the official epicrisis page count order', async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    source.addPage([612, 792]);
    source.addPage([612, 792]);
    const helper = {
      extractOfficialEpicrisisLayout: async () => ({
        recipePageIndex: 1,
        recipeTitleY: 160,
        headerBottomY: 520,
        headerItems: [
          { x: 35, y: 700, text: 'DATOS DEL PACIENTE' },
          { x: 35, y: 670, text: 'RUN: 15.066.726-7' },
        ],
        recipeItems: [
          { x: 35, y: 160, text: 'RECETA DE ALTA' },
          { x: 35, y: 130, text: 'Medicamento' },
          { x: 35, y: 100, text: 'Tratamiento de prueba' },
        ],
        recipeLines: [{ x0: 35, x1: 575, y: 120 }],
        titleItems: [
          { x: 260, y: 744 },
          { x: 260, y: 744 },
          { x: 260, y: 744 },
        ],
      }),
    };
    const api = (
      globalThis as typeof globalThis & {
        HhrEpicrisisPdf: {
          correctEpicrisisPrescriptionPages: (
            buffer: Uint8Array,
            inputHelper: typeof helper,
            pdfLibrary: typeof import('pdf-lib')
          ) => Promise<Uint8Array>;
        };
      }
    ).HhrEpicrisisPdf;
    const corrected = await api.correctEpicrisisPrescriptionPages(
      await source.save(),
      helper,
      await import('pdf-lib')
    );
    const result = await PDFDocument.load(corrected);
    expect(result.getPageCount()).toBe(4);
  });
});
