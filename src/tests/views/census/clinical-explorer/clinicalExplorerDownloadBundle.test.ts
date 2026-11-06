import { PDFDocument } from 'pdf-lib';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import {
  DownloadAssemblyError,
  mergePdfDocuments,
  readHistoryArchive,
  renderCtReportTextPdf,
  renderLabResultsPdf,
  zipDocuments,
} from '@/features/census/components/clinical-explorer/clinicalExplorerDownloadBundle';
import type { DownloadDocument } from '@/features/census/components/clinical-explorer/clinicalExplorerDownloadModel';

/** A synthetic PDF whose pages have a known width, so the order of a join can be read back. */
const syntheticPdf = async (width: number, pages = 1): Promise<Uint8Array> => {
  const doc = await PDFDocument.create();
  for (let page = 0; page < pages; page += 1) doc.addPage([width, 400]);
  return doc.save();
};

const widths = async (bytes: Uint8Array): Promise<number[]> =>
  (await PDFDocument.load(bytes)).getPages().map(page => Math.round(page.getWidth()));

const heading = {
  patientName: 'PACIENTE SINTÉTICO',
  rut: '12.345.678-5',
  generatedAt: '06-11-2026 14:30',
};

describe('explorer download assembly', () => {
  it('takes the history PDFs of the extension ZIP in admission order and leaves the summary out', async () => {
    const zip = new PizZip();
    zip.file('00 Resumen.csv', 'RUT;Nombre\r\n');
    zip.file(
      'PACIENTE - 12345678-5 - Historial hospitalizacion - ingreso 2026-11-03.pdf',
      await syntheticPdf(200),
      { binary: true }
    );
    zip.file(
      'PACIENTE - 12345678-5 - Historial hospitalizacion - ingreso 2026-10-01.pdf',
      await syntheticPdf(210),
      { binary: true }
    );
    const archive = new Blob([zip.generate({ type: 'uint8array' })], { type: 'application/zip' });

    const files = await readHistoryArchive(archive);

    expect(files.map(file => file.name)).toEqual([
      'PACIENTE - 12345678-5 - Historial hospitalizacion - ingreso 2026-10-01.pdf',
      'PACIENTE - 12345678-5 - Historial hospitalizacion - ingreso 2026-11-03.pdf',
    ]);
    expect(await widths(files[0]!.bytes)).toEqual([210]);
  });

  it('joins every page of every document in the order given', async () => {
    const documents: DownloadDocument[] = [
      { part: 'record', fileName: 'ficha.pdf', bytes: await syntheticPdf(100, 2) },
      { part: 'lab', fileName: 'lab.pdf', bytes: await syntheticPdf(200) },
      { part: 'ct', fileName: 'tac.pdf', bytes: await syntheticPdf(300) },
    ];
    expect(await widths(await mergePdfDocuments(documents))).toEqual([100, 100, 200, 300]);
  });

  it('names the document it cannot read instead of joining without it', async () => {
    const documents: DownloadDocument[] = [
      { part: 'record', fileName: 'ficha.pdf', bytes: await syntheticPdf(100) },
      { part: 'ct', fileName: 'tac roto.pdf', bytes: new TextEncoder().encode('not a pdf') },
    ];
    const join = mergePdfDocuments(documents);
    await expect(join).rejects.toBeInstanceOf(DownloadAssemblyError);
    await expect(join).rejects.toThrow('No se pudo leer «tac roto.pdf» para unirlo.');
  });

  it('packs each document as its own file, numbered by part, with its bytes intact', async () => {
    const ficha = await syntheticPdf(100);
    const zip = new PizZip(
      zipDocuments([
        { part: 'record', fileName: 'ficha.pdf', bytes: ficha },
        { part: 'lab', fileName: 'lab.pdf', bytes: await syntheticPdf(200) },
        { part: 'ct', fileName: 'tac.pdf', bytes: await syntheticPdf(300) },
      ])
    );
    expect(Object.keys(zip.files)).toEqual(['1 ficha.pdf', '2 lab.pdf', '3 tac.pdf']);
    expect(zip.file('1 ficha.pdf')?.asUint8Array()).toEqual(ficha);
  });

  it('writes the Syslab results and a CT report text as readable PDFs', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      columnKey: '02/11/2026 08:30',
      name: `Analito sintético ${index}`,
      time: '08:30',
      display: String(index),
      unit: 'μmol/L',
      refValue: '1 - 2',
    }));
    const lab = renderLabResultsPdf({
      ...heading,
      range: { from: '2026-11-01', to: '2026-11-06' },
      groups: [{ columnKey: '02/11/2026 08:30', dayIso: '2026-11-02', time: '08:30', rows }],
    });
    // 120 results do not fit on one A4 page: the table continues instead of being cut.
    expect((await PDFDocument.load(lab)).getPageCount()).toBeGreaterThan(1);

    const ct = renderCtReportTextPdf({
      ...heading,
      exam: {
        nombre_examen: 'TC tórax',
        fecha_examen: '03/11/2026 10:15',
        fecha_asignacion: '03/11/2026',
        mod: 'CT',
        estado: 'Validado',
        pdf_url: null,
        dicom_url: null,
        informe_html_url: null,
        report: {
          title: 'TC de tórax',
          technique: 'Técnica sintética.',
          antecedentesClinicos: null,
          findings: 'Hallazgo sintético.',
          impression: 'Impresión sintética.',
        },
      },
    });
    expect((await PDFDocument.load(ct)).getPageCount()).toBe(1);
  });
});
