import { Workbook } from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { buildCudyrReportWorkbook } from '@/services/cudyr/cudyrReportWorkbook';
import {
  reportInput,
  reportRecord,
  reportPatient,
  reportObservation,
  reportCapture,
} from './reportFixtures';

vi.mock('@/services/exporters/excelUtils', async () => {
  const { Workbook } = await import('exceljs');
  return { createWorkbook: async () => new Workbook(), BORDER_THIN: {} };
});
describe('contextual CUDYR Excel', () => {
  it('roundtrips a real xlsx, retains original daily formula positions and exports identifiable traceability as literal text', async () => {
    const record = reportRecord();
    record.beds.NEO1 = reportPatient({
      bedId: 'NEO1',
      clinicalEpisodeId: 'second',
      patientName: '=HYPERLINK("test")',
    });
    const input = reportInput({
      records: [record],
      observations: [reportObservation()],
      captures: [reportCapture()],
    });
    const data = buildCudyrReport(input);
    const { workbook } = await buildCudyrReportWorkbook(data);
    const reopened = new Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    const summary = reopened.getWorksheet('Resumen CUDYR Mensual')!;
    const daily = reopened.getWorksheet('02-10-2026')!;
    expect(summary.getCell('B3').value).toBe('INTERMEDIAS');
    expect(summary.getCell('C3').value).toBe('MEDIAS');
    expect(daily.getCell('B11').value).toBe(1); // C2, original row positions.
    expect(daily.getCell('C15').value).toBe(1); // D3.
    expect(summary.getCell('B11').value).toMatchObject({ result: 1 });
    const detail = reopened.getWorksheet('Detalle diario')!;
    const headings = detail.getRow(1).values as string[];
    const value = (row: number, heading: string) =>
      detail.getRow(row).getCell(headings.indexOf(heading)).value;
    expect(value(2, 'Nombre completo')).toBe('=HYPERLINK("test")');
    expect(value(3, 'RUT o documento')).toBe('synthetic-rut');
    expect(value(3, 'Diagnóstico')).toBe('Diagnóstico sintético');
    expect(value(3, 'Autor CUDYR')).toBe('Autora Sintética');
    expect(value(3, 'Usuario sincronizador')).toBe('sync@example.com');
    expect(value(3, 'Evaluación fecha hora ISO')).toBe('2026-10-03T03:00:00-05:00');
    expect(reopened.getWorksheet('Evaluaciones y versiones')!.rowCount).toBe(2);
    expect(reopened.getWorksheet('Metodología')).toBeDefined();
    expect(reopened.getWorksheet('Cobertura')!.rowCount).toBe(5);
  });
  it('does not manufacture zero-valued daily sheets for unavailable or failed censuses', async () => {
    const data = buildCudyrReport(
      reportInput({
        records: [],
        coverage: [
          { date: '2026-10-01', state: 'sin_censo', lastSyncedAt: '', runId: '' },
          { date: '2026-10-02', state: 'error', lastSyncedAt: '', runId: '' },
        ],
      })
    );
    const { workbook } = await buildCudyrReportWorkbook(data);
    expect(workbook.getWorksheet('01-10-2026')).toBeUndefined();
    expect(workbook.getWorksheet('02-10-2026')).toBeUndefined();
    expect(workbook.getWorksheet('Cobertura')!.rowCount).toBe(3);
  });
  it('preserves unidentified archive identities in context rows without counting versions as patient-days', async () => {
    const observation = reportObservation();
    observation.evaluation.clinicalEpisodeId = '';
    observation.captureContexts[0].clinicalEpisodeId = '';
    const data = buildCudyrReport(
      reportInput({
        records: [],
        observations: [observation, { ...observation, id: 'version-two' }],
      })
    );
    const { workbook } = await buildCudyrReportWorkbook(data);
    expect(data.rows).toHaveLength(0);
    expect(workbook.getWorksheet('Contextos capturados')!.getCell('F2').value).toBe(
      'Paciente Sintético'
    );
    expect(workbook.getWorksheet('Contextos capturados')!.rowCount).toBe(3);
    expect(workbook.getWorksheet('Evaluaciones y versiones')!.rowCount).toBe(3);
  });
  it('marks incomplete reports and keeps an empty dataset free of invalid formulas', async () => {
    const data = buildCudyrReport(
      reportInput({ records: [], coverage: [], issues: ['Lectura incompleta'] })
    );
    const { workbook } = await buildCudyrReportWorkbook(data);
    expect(workbook.worksheets[0].getCell('A2').value).toContain('REVISIÓN PENDIENTE');
    workbook.eachSheet(sheet =>
      sheet.eachRow(row =>
        row.eachCell(cell => {
          if (cell.type === 6) expect(cell.formula).not.toBe('');
        })
      )
    );
    expect((await workbook.xlsx.writeBuffer()).byteLength).toBeGreaterThan(5000);
  });
});
