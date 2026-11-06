import { describe, expect, it } from 'vitest';
import { isVersionAtLeast } from '@/features/census/components/clinical-explorer/clinicalExplorerDownloadModel';
import {
  countPendingInRange,
  parseHistorySummary,
  splitCtStudiesByDay,
} from '@/features/census/components/clinical-explorer/clinicalExplorerDownloadScope';
import type { MMRADExam } from '@/services/radiology/mmradService';

const exam = (overrides: Partial<MMRADExam>): MMRADExam => ({
  nombre_examen: 'TC tórax',
  fecha_examen: '01/11/2026 09:00',
  fecha_asignacion: '01/11/2026',
  mod: 'CT',
  estado: 'Validado',
  pdf_url: null,
  dicom_url: null,
  informe_html_url: null,
  report: null,
  ...overrides,
});

describe('extension version and ZIP summary', () => {
  it('compares versions numerically and rejects unreadable ones', () => {
    expect(isVersionAtLeast('0.48.74', '0.48.71')).toBe(true);
    expect(isVersionAtLeast('0.48.71', '0.48.71')).toBe(true);
    expect(isVersionAtLeast('0.48.9', '0.48.71')).toBe(false);
    expect(isVersionAtLeast('0.49', '0.48.71')).toBe(true);
    expect(isVersionAtLeast('dev', '0.48.71')).toBe(false);
  });

  it('reads each listed stay and its file from the extension summary, quotes included', () => {
    const csv =
      '\uFEFFRUT;Nombre;Ingreso;Egreso;Documento;Resultado;Archivo\r\n' +
      '12.345.678-5;"PÉREZ; ANA";2026-11-01;En curso;Historial de hospitalización;Descargado;"a.pdf"\r\n' +
      '12.345.678-5;PÉREZ;2026-11-01;2026-11-01;Historial de hospitalización;No descargado: HTTP 500;\r\n' +
      '12.345.678-5;;;;;Sin hospitalizaciones en el periodo;\r\n';
    expect(parseHistorySummary(csv)).toEqual([
      { startDate: '2026-11-01', fileName: 'a.pdf' },
      { startDate: '2026-11-01', fileName: '' },
    ]);
    expect(parseHistorySummary('RUT;Nombre\r\n')).toBeNull();
  });

  it('keeps a stay whose quoted name spans lines, so a duplicate admission is never hidden', () => {
    const csv =
      '\uFEFFRUT;Nombre;Ingreso;Egreso;Documento;Resultado;Archivo\r\n' +
      '12.345.678-5;"Paciente\nSintetico";2026-11-01;2026-11-01;Historial de hospitalización;No descargado: HTTP 500;\r\n' +
      '12.345.678-5;PACIENTE;2026-11-01;En curso;Historial de hospitalización;Descargado;b.pdf\r\n';
    expect(parseHistorySummary(csv)).toEqual([
      { startDate: '2026-11-01', fileName: '' },
      { startDate: '2026-11-01', fileName: 'b.pdf' },
    ]);
    // A cell left open, or a document row without a readable «Ingreso», cannot be trusted.
    expect(parseHistorySummary(csv.replace('"Paciente', 'Paciente'))).toBeNull();
    expect(
      parseHistorySummary(
        'RUT;Nombre;Ingreso;Egreso;Documento;Resultado;Archivo\r\n1;A;;;Historial de hospitalización;Descargado;a.pdf\r\n'
      )
    ).toBeNull();
  });

  it('sets apart CT studies after a past census day and counts pending reports by range', () => {
    const before = exam({ nombre_examen: 'TC tórax', fecha_examen: '01/11/2026 09:00' });
    const after = exam({ nombre_examen: 'TC abdomen', fecha_examen: '05/11/2026 10:00' });
    expect(splitCtStudiesByDay([before, after], '2026-11-01')).toEqual({
      kept: [before],
      later: [after],
    });
    expect(splitCtStudiesByDay([before, after], null)).toEqual({
      kept: [before, after],
      later: [],
    });
    const range = { from: '2026-11-02', to: '2026-11-04' };
    expect(countPendingInRange(['2026-11-01', '2026-11-03', '', '2026-11-05'], range)).toBe(2);
  });
});
