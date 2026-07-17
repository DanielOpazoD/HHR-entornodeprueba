// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import '../../../extension/epicrisis-pdf.js';
import '../../../extension/prescription-print.js';

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
          { x: 35, y: 670, text: 'RUN: 15.066.726-7 ' },
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
            pdfLibrary: typeof import('pdf-lib'),
            options: { expectedPatientRun: string }
          ) => Promise<Uint8Array>;
        };
      }
    ).HhrEpicrisisPdf;
    const corrected = await api.correctEpicrisisPrescriptionPages(
      await source.save(),
      helper,
      await import('pdf-lib'),
      { expectedPatientRun: '15.066.726-7' }
    );
    const result = await PDFDocument.load(corrected);
    expect(result.getPageCount()).toBe(4);
  });

  it('adds prescription pages instead of drawing continuation rows below the page', async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    source.addPage([612, 792]);
    source.addPage([612, 792]);
    const helper = {
      extractOfficialEpicrisisLayout: async () => ({
        recipePageIndex: 1,
        recipeEndPageIndex: 2,
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
              { x: 35, y: 100, text: 'Primer medicamento' },
            ],
            lines: [],
          },
          {
            items: Array.from({ length: 25 }, (_, index) => ({
              x: 35,
              y: 500 - index * 20,
              text: `Continuación ${index + 1}`,
            })),
            lines: [],
          },
        ],
        control: null,
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
            pdfLibrary: typeof import('pdf-lib'),
            options: { expectedPatientRun: string }
          ) => Promise<Uint8Array>;
        };
      }
    ).HhrEpicrisisPdf;
    const corrected = await api.correctEpicrisisPrescriptionPages(
      await source.save(),
      helper,
      await import('pdf-lib'),
      { expectedPatientRun: '15.066.726-7' }
    );
    const result = await PDFDocument.load(corrected);
    expect(result.getPageCount()).toBeGreaterThanOrEqual(4);
  });

  it('rejects a captured alta PDF from a different patient', async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    const helper = {
      extractOfficialEpicrisisLayout: async () => ({
        recipePageIndex: 0,
        recipeEndPageIndex: 0,
        recipeTitleY: 160,
        headerBottomY: 520,
        headerItems: [{ x: 35, y: 670, text: 'RUN: 11.111.111-1' }],
        recipeParts: [{ items: [{ x: 35, y: 100, text: 'Medicamento' }], lines: [] }],
        control: null,
        titleItems: [{ x: 260, y: 744 }],
      }),
    };
    const api = (
      globalThis as typeof globalThis & {
        HhrEpicrisisPdf: {
          correctEpicrisisPrescriptionPages: (
            buffer: Uint8Array,
            inputHelper: typeof helper,
            pdfLibrary: typeof import('pdf-lib'),
            options: { expectedPatientRun: string }
          ) => Promise<Uint8Array>;
        };
      }
    ).HhrEpicrisisPdf;
    await expect(
      api.correctEpicrisisPrescriptionPages(await source.save(), helper, await import('pdf-lib'), {
        expectedPatientRun: '15.066.726-7',
      })
    ).rejects.toThrow('no corresponde al paciente seleccionado');
  });

  it('does not accept a partial RUN match from a longer patient identifier', async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    const helper = {
      extractOfficialEpicrisisLayout: async () => ({
        recipePageIndex: 0,
        recipeEndPageIndex: 0,
        recipeTitleY: 160,
        headerBottomY: 520,
        headerItems: [
          { x: 35, y: 670, text: 'RUN:' },
          { x: 130, y: 670, text: '15.066.726-7' },
        ],
        recipeParts: [{ items: [{ x: 35, y: 100, text: 'Medicamento' }], lines: [] }],
        control: null,
        titleItems: [{ x: 260, y: 744 }],
      }),
    };
    const api = (
      globalThis as typeof globalThis & {
        HhrEpicrisisPdf: {
          correctEpicrisisPrescriptionPages: (
            buffer: Uint8Array,
            inputHelper: typeof helper,
            pdfLibrary: typeof import('pdf-lib'),
            options: { expectedPatientRun: string }
          ) => Promise<Uint8Array>;
        };
      }
    ).HhrEpicrisisPdf;
    await expect(
      api.correctEpicrisisPrescriptionPages(await source.save(), helper, await import('pdf-lib'), {
        expectedPatientRun: '5.066.726-7',
      })
    ).rejects.toThrow('no corresponde al paciente seleccionado');
  });

  it('uses a finite header boundary and accepts continuation pages without Próximo Control', () => {
    const source = readFileSync(path.resolve('extension/prescription-print.js'), 'utf8');
    const epicrisisStart = source.indexOf('var extractOfficialEpicrisisLayout');
    const epicrisisEnd = source.indexOf('var derivePrescriptionDates', epicrisisStart);
    const extractor = source.slice(epicrisisStart, epicrisisEnd);
    expect(extractor).toContain('continuationDate ? continuationDate.y - 22 : headerBottomY');
    expect(extractor).toContain('headerContentBottomY = Math.max(0, headerDate.y - 4)');
    expect(extractor).toContain('item.y >= headerContentBottomY');
    expect(extractor).not.toContain('Number.POSITIVE_INFINITY');
    expect(extractor).not.toContain('recipeParts.length > 1 && !control');
    expect(extractor).toContain('recipeEndPageIndex: recipeEndPageIndex');
    expect(extractor).toContain('!pageRun || pageRun === recipePatientRun');
    expect(extractor).toContain('hasNoConflictingPatientRun(safeItems)');
    expect(extractor).toContain('controlTitle && hasNoConflictingPatientRun(continuationItems)');
    expect(extractor).toContain('hasMedication && hasPrescriptionLines');
    expect(extractor).toContain('if (!confirmedContinuation) break;');
    expect(extractor).not.toContain('hasMedicationDate');
  });
});
