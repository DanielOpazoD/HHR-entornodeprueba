import { expect } from 'vitest';
import { Workbook } from 'exceljs';
import { addCudyrSourceSheets, type CudyrSourceSheet } from '@/services/cudyr/cudyrSourceWorkbook';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { confirmedReportInput } from './reportFixtures';
import type { CudyrReportRow } from '@/types/domain/cudyrReport';

const header = [
  'N°',
  'Nombre Paciente',
  'Ficha Clínica',
  'RUN o Nro. Ident.',
  'Diagnóstico de Ingreso',
  'Días Hosp.',
  'Servicio Clínico',
  'Condición Alta',
  ...Array.from({ length: 31 }, (_, i) => `Día ${i + 1}`),
];
export const source = (): CudyrSourceSheet => ({
  month: '2026-10',
  reportId: 'source',
  file: { name: 'synthetic.xls', sha256: 'synthetic', byteLength: 100 },
  matrix: {
    sheet: 'Original',
    merges: [],
    widths: [],
    heights: [],
    formats: {},
    rows: [
      ['Hospital Hanga Roa (Isla de Pascua)', 'Categorización Riesgo Dependencia'],
      ['Mes consultado: Octubre de 2026'],
      header,
      [1, 'Paciente Sintético', 'FICHA', 'DOC', 'Diagnóstico', '2', 'MQ', 'Vivo', 'C2', 'S/C'],
      ['Página 2'],
      header,
      ['', 'Apellido', '', '', 'continuado', '', 'continuado'],
      [2, 'Paciente Sintético', 'FICHA', 'DOC', 'Otro episodio', '1', 'MQ', 'Vivo', '', 'D3'],
    ],
  },
});
export const row = (): CudyrReportRow => ({
  ...buildCudyrReport(confirmedReportInput()).rows[0],
  clinicalEpisodeId: 'episode',
  date: '2026-09-30',
  hospitalAdmissionAt: '2026-10-01T06:47:00Z',
  admissionEvidenceConflict: false,
  monthlyEvidence: {
    reportId: 'source',
    sourceRow: 4,
    sourceDate: '2026-10-01',
    checkedAt: '',
    state: 'found',
  },
  movements: [
    {
      clinicalEpisodeId: 'episode',
      censusDate: '2026-10-01',
      id: 'exit',
      section: 'discharges',
      bedId: 'R1',
      bedName: 'R1',
      service: 'MQ',
      modality: 'hospitalizacion',
      date: '2026-10-02',
      time: '01:47',
      recordedAt: '2026-10-03T12:00:00Z',
      source: 'gestion_camas',
      lineageId: 'exit',
      medicalEpicrisisStatus: '',
      nursingEpicrisisStatus: '',
      epicrisisRegisteredAt: '2026-10-03T10:00:00Z',
    },
  ],
});
export const exportSheet = async (
  rows: CudyrReportRow[] = [],
  current = source(),
  month = '2026-10'
) => {
  const before = JSON.stringify({ rows, current });
  const workbook = new Workbook();
  addCudyrSourceSheets(workbook, [current], month, rows);
  const reopened = new Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  expect(JSON.stringify({ rows, current })).toBe(before);
  return reopened.worksheets[0];
};
