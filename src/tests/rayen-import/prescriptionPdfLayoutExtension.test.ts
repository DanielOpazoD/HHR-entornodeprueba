// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { prescriptionPdf } from './prescriptionPdfTestHarness';

type PdfOperation = { name: string; args: unknown[]; page: number };

class LayoutRecorder {
  static latest: LayoutRecorder;

  readonly internal = {
    pageSize: {
      getWidth: () => 612,
      getHeight: () => 792,
    },
  };

  readonly operations: PdfOperation[] = [];
  readonly options: unknown;
  private page = 1;
  private pageCount = 1;

  constructor(options: unknown) {
    this.options = options;
    LayoutRecorder.latest = this;
  }

  private record(name: string, args: IArguments | unknown[]) {
    this.operations.push({ name, args: Array.from(args), page: this.page });
    return this;
  }

  setTextColor(...args: unknown[]) { return this.record('setTextColor', args); }
  setFont(...args: unknown[]) { return this.record('setFont', args); }
  setFontSize(...args: unknown[]) { return this.record('setFontSize', args); }
  text(...args: unknown[]) { return this.record('text', args); }
  setFillColor(...args: unknown[]) { return this.record('setFillColor', args); }
  setDrawColor(...args: unknown[]) { return this.record('setDrawColor', args); }
  rect(...args: unknown[]) { return this.record('rect', args); }
  line(...args: unknown[]) { return this.record('line', args); }

  splitTextToSize(value: unknown, width: number) {
    this.record('splitTextToSize', [value, width]);
    return String(value).split('\n');
  }

  addPage() {
    this.pageCount += 1;
    this.page = this.pageCount;
    return this.record('addPage', []);
  }

  setPage(page: number) {
    this.page = page;
    return this.record('setPage', [page]);
  }

  getNumberOfPages() {
    return this.pageCount;
  }

  output(type: string) {
    this.record('output', [type]);
    return new ArrayBuffer(8);
  }
}

const commonData = {
  patient: {
    name: 'Paciente de prueba',
    run: '12.345.678-9',
    sex: 'Mujer',
    age: '60 años',
    bed: 'H6C1',
    room: 'Habitación 6',
    service: 'AMQI',
    diagnosis: 'Diagnóstico de prueba',
  },
  professional: 'Elena Díaz',
  professionalRun: '17.752.753-K',
  validationDate: '2026-07-14',
  validationDateTime: '2026-07-14T21:30:00-04:00',
  emissionDateTime: '14-07-2026 21:45',
};

describe('professional prescription PDF layout contract', () => {
  it('keeps the standard jsPDF options, table geometry, signature and footer positions', () => {
    prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        ...commonData,
        printFormat: 'standard',
        medications: [
          {
            medication: 'Paracetamol 500 mg',
            posology: '1 comprimido cada 8 horas',
            route: 'Oral',
            date: '2026-07-14',
          },
        ],
      },
      LayoutRecorder as never
    );

    const recorder = LayoutRecorder.latest;
    expect(recorder.options).toEqual({
      orientation: 'portrait',
      unit: 'pt',
      format: 'letter',
      compress: true,
    });
    expect(recorder.operations.filter(({ name }) => name === 'rect').map(({ args }) => args)).toEqual([
      [36, 171, 540, 24, 'FD'],
      [36, 195, 540, 38],
    ]);
    expect(recorder.operations).toContainEqual({
      name: 'line',
      args: [426, 307, 576, 307],
      page: 1,
    });
    expect(recorder.operations).toContainEqual({
      name: 'text',
      args: ['FIRMA', 501, 319, { align: 'center' }],
      page: 1,
    });
    expect(recorder.operations).toContainEqual({
      name: 'text',
      args: ['Pagina 1 de 1', 576, 764, { align: 'right' }],
      page: 1,
    });
  });

  it('keeps the 22-row long-compact boundary and official dispatch column on continuation pages', () => {
    prescriptionPdf.generateProfessionalPrescriptionPdf(
      {
        ...commonData,
        printFormat: 'compact',
        officialEquivalent: true,
        folio: 'D292620E',
        printedBy: 'Valeria Salfate',
        address: 'Simón Paoa N°S/N',
        medications: Array.from({ length: 23 }, (_, index) => ({
          medication: `Medicamento oficial ${index + 1}`,
          posology: '1 comprimido al día',
          dispatch: index === 0 ? 'Pendiente' : '',
          date: '2026-07-14',
        })),
      },
      LayoutRecorder as never
    );

    const recorder = LayoutRecorder.latest;
    const rowRects = recorder.operations.filter(
      ({ name, args }) => name === 'rect' && args.length === 4
    );
    expect(rowRects).toHaveLength(23);
    expect(rowRects.slice(0, 22).every(({ page }) => page === 1)).toBe(true);
    expect(rowRects[22]).toEqual({ name: 'rect', args: [22, 117, 568, 20], page: 2 });
    expect(recorder.operations).toContainEqual({
      name: 'text',
      args: [['Pendiente'], 479.5, 136.3],
      page: 1,
    });
    expect(recorder.operations).toContainEqual({
      name: 'text',
      args: ['Pagina 1 de 2', 590, 776, { align: 'right' }],
      page: 1,
    });
    expect(recorder.operations).toContainEqual({
      name: 'text',
      args: ['Pagina 2 de 2', 590, 776, { align: 'right' }],
      page: 2,
    });
  });
});
