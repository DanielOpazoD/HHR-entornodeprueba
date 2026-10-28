import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DocumentaryCudyr } from '@/domain/evaluationScales/documentaryCudyr';
import type { CapturedCudyrMonthlyReport } from '@/services/cudyr/cudyrMonthlyReportCapture';
import { utils, write } from 'xlsx';
import { parseCudyrSupplementBinary } from '@/services/cudyr/cudyrSupplementBinary';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { createEmptyPatient } from '@/services/factories/patientFactory';

export const now = () => new Date('2026-10-27T20:00:00-05:00');
export const patient = () => ({
  ...createEmptyPatient('R1'),
  patientName: 'Paciente Sintético',
  rut: '11.111.111-1',
  documentType: 'RUT' as const,
  clinicalEpisodeId: 'synthetic-episode-a',
  admissionDate: '2026-10-20',
});
export const historicalDay = (): DailyRecord => ({
  ...buildInitializedDayRecord('2026-10-26', null),
  beds: { R1: patient() },
});
export const currentDay = (): DailyRecord => {
  const record = buildInitializedDayRecord('2026-10-27', null);
  record.discharges = [
    {
      id: 'discharge-a',
      clinicalEpisodeId: patient().clinicalEpisodeId,
      bedId: 'R1',
      bedName: 'R1',
      bedType: 'Intermedia',
      patientName: patient().patientName,
      rut: patient().rut,
      diagnosis: '',
      time: '14:00',
      movementDate: record.date,
      status: 'Vivo',
      originalData: patient(),
    },
  ];
  return record;
};
export const reportBytes = () => {
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['MINISTERIO DE SALUD', 'Fecha Hora Impresión: 27-10-2026 20:00'],
      ['Hospital Hanga Roa (Isla De Pascua)', 'Categorización Riesgo Dependencia'],
      ['Mes consultado: Octubre de 2026'],
      [
        'N°',
        'Nombre Paciente',
        'Ficha Clínica',
        'RUN o Nro. Ident.',
        'Diagnóstico de Ingreso',
        'Días Hosp.',
        'Servicio Clínico',
        'Condición Alta',
        ...Array.from({ length: 31 }, (_, i) => `Día ${i + 1}`),
      ],
      [
        1,
        patient().patientName,
        'SYNTHETIC',
        patient().rut,
        '',
        7,
        'MQ',
        'Vivo',
        ...Array.from({ length: 31 }, (_, i) => (i === 26 ? 'C2' : '')),
      ],
    ]),
    'Synthetic'
  );
  const buffer: ArrayBuffer = write(book, { type: 'array', bookType: 'biff8' });
  return buffer;
};
export const parsedSource = (): CapturedCudyrMonthlyReport => {
  const parsed = parseCudyrSupplementBinary(reportBytes());
  if (!parsed.ok) throw new Error('Invalid synthetic XLS');
  return {
    report: parsed.report,
    reportId: 'synthetic-content-id',
    capturedAt: now().toISOString(),
  };
};
export const documentary = (): DocumentaryCudyr => ({
  category: 'C2',
  recordedDate: '2026-10-26',
  source: 'Eloísa · informe mensual',
  documentaryEvidence: {
    reportId: 'synthetic-content-id',
    sourceRow: 5,
    sourceDate: '2026-10-27',
    clinicalEpisodeId: 'synthetic-episode-a',
    document: '11.111.111-1',
    patientName: 'Paciente Sintético',
    documentType: 'RUT',
  },
});
