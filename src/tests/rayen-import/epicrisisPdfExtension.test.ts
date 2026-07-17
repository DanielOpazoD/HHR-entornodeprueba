// @vitest-environment jsdom
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import '../../../extension/epicrisis-pdf.js';

describe('epicrisis PDF extension', () => {
  it('places next control before one compact prescription page', async () => {
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
        recipeParts: [
          {
            items: [
              { x: 35, y: 160, text: 'RECETA DE ALTA' },
              { x: 35, y: 130, text: 'Medicamento' },
              { x: 35, y: 100, text: 'Tratamiento de prueba' },
            ],
            lines: [{ x0: 35, x1: 575, y: 120 }],
          },
          {
            items: [{ x: 35, y: 160, text: 'Continuación del tratamiento' }],
            lines: [],
          },
        ],
        control: {
          pageIndex: 2,
          headerItems: [
            { x: 35, y: 700, text: 'DATOS DEL PACIENTE' },
            { x: 35, y: 670, text: 'RUN: 15.066.726-7' },
          ],
          items: [
            { x: 35, y: 360, text: 'PRÓXIMO CONTROL' },
            { x: 35, y: 320, text: 'Profesional: Dr. Rodriguez' },
          ],
          lines: [],
        },
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
