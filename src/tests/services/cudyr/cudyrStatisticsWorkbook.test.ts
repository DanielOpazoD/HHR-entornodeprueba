import { Workbook } from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { buildCudyrReportWorkbook } from '@/services/cudyr/cudyrReportWorkbook';
import { reportInput, reportObservation, reportCapture } from './reportFixtures';

vi.mock('@/services/exporters/excelUtils', async () => {
  const { Workbook } = await import('exceljs');
  return { createWorkbook: async () => new Workbook(), BORDER_THIN: {} };
});

describe('CUDYR statistics and audit downloads', () => {
  it('roundtrips 30 readable columns with the same patients and summary formulas as the complete audit', async () => {
    const data = buildCudyrReport(
      reportInput({
        observations: [reportObservation()],
        captures: [reportCapture()],
      })
    );
    data.rows[0].patientName = '=HYPERLINK("synthetic")';
    const before = structuredClone(data);
    const standard = await buildCudyrReportWorkbook(data, []);
    const audit = await buildCudyrReportWorkbook(data, [], 'audit');
    expect(standard.fileName).toBe('CUDYR_Estadistica_2026-10-01_a_2026-10-04.xlsx');
    expect(audit.fileName).toBe('CUDYR_Auditoria_2026-10-01_a_2026-10-04.xlsx');
    const reopened = new Workbook();
    await reopened.xlsx.load(await standard.workbook.xlsx.writeBuffer());
    const detail = reopened.getWorksheet('Detalle diario')!;
    expect(detail.columnCount).toBe(30);
    expect(detail.rowCount).toBe(data.rows.length + 1);
    expect(detail.getCell('B2').value).toBe('=HYPERLINK("synthetic")');
    expect(detail.getCell('S2').value).toBe('Autora Sintética');
    expect(detail.getCell('U2').value).toBe('sync@example.com');
    expect(audit.workbook.getWorksheet('Detalle diario')!.columnCount).toBe(54);
    for (const name of [
      'Capturas',
      'Contextos capturados',
      'Evaluaciones y versiones',
      'Ítems CUDYR',
      'Asignaciones de cama',
      'Movimientos y egresos',
      'Auditoría altas reales',
    ]) {
      expect(reopened.getWorksheet(name)).toBeUndefined();
      expect(audit.workbook.getWorksheet(name)).toBeDefined();
    }
    for (const name of [
      'Resumen CUDYR Mensual',
      '01-10-2026',
      '02-10-2026',
      '03-10-2026',
      '04-10-2026',
    ])
      expect(standard.workbook.getWorksheet(name)!.getSheetValues()).toEqual(
        audit.workbook.getWorksheet(name)!.getSheetValues()
      );
    expect(reopened.getWorksheet('Cobertura')!.columnCount).toBe(3);
    expect(data).toEqual(before);
  });

  it('combines source dates without inventing hours and retains distinct bed labels and separate discharge facts', async () => {
    const data = buildCudyrReport(reportInput({ observations: [reportObservation()] }));
    const row = data.rows[0];
    row.admissionTime = '';
    row.bedId = 'R1';
    row.bedName = 'Recuperación 1';
    row.correction = {
      schemaVersion: 1,
      clinicalEpisodeId: row.clinicalEpisodeId,
      revision: 1,
      operationId: 'synthetic-operation',
      authorityDate: row.date,
      admissionDate: row.admissionDate,
      sourceContexts: [],
      actualDischarge: { date: '2026-10-04', timeZone: 'Pacific/Easter' },
      updatedAt: '2026-10-05T15:00:00Z',
      updatedBy: {
        uid: 'synthetic',
        name: 'Revisor sintético',
        email: 'test@example.com',
        role: 'admin',
      },
      reason: 'Respaldo sintético',
    };
    const { workbook } = await buildCudyrReportWorkbook(data);
    const sheet = workbook.getWorksheet('Detalle diario')!;
    expect(sheet.getCell('F2').value).toBe('2026-09-20 (hora no informada)');
    expect(sheet.getCell('G2').value).toBe('Recuperación 1 (R1)');
    expect(sheet.getCell('V2').value).toBe(''); // No system egreso is invented from the correction.
    expect(sheet.getCell('W2').value).toBe('2026-10-04 (hora no informada)');
    expect(sheet.getCell('X2').value).toBe('Revisor sintético');
    expect(sheet.getCell('R2').value).toContain('3:00');
    expect(row.evaluation?.recordedAt).toBe('2026-10-03T03:00:00-05:00');
  });
});
