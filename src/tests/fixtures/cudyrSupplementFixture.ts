import { utils, write } from 'xlsx';
/** Entirely synthetic, valid BIFF workbook. */
export const supplementBytes = (
  report: import('@/types/domain/cudyrSupplement').CudyrSupplementReport
) => {
  const p = report.patients;
  const rows = [
    ['MINISTERIO DE SALUD', report.generatedLabel],
    [report.establishment, 'Categorización Riesgo Dependencia'],
    ['Mes consultado: Octubre de 2026'],
    [
      'N°',
      'Nombre Paciente',
      'Ficha Clínica',
      'RUN o Nro. Ident.',
      '',
      'Diagnóstico de Ingreso',
      '',
      'Días Hosp.',
      'Servicio Clínico',
      '',
      'Condición Alta',
      ...Array.from({ length: 31 }, (_, i) => `Día ${i + 1}`),
    ],
    ...p.map(v => [
      v.ordinal,
      v.patientName,
      v.clinicalRecord,
      v.document,
      '',
      v.diagnosis,
      '',
      v.hospitalDays,
      v.service,
      '',
      v.dischargeCondition,
      ...v.days.map(d => d.originalValue),
    ]),
  ];
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), report.sheet);
  return write(book, { bookType: 'biff8', type: 'base64' }) as string;
};
export const supplementRequest = () => {
  const request = {
    kind: 'import-monthly-supplement',
    schemaVersion: 1 as const,
    confirmed: true,
    operationId: '00000000-0000-4000-8000-000000000001',
    file: { name: 'synthetic.xls', base64: '0M8R4KGxGuE=' },
    report: {
      schemaVersion: 1 as const,
      source: 'eloisa_monthly_report' as const,
      month: '2026-10',
      establishment: 'Hospital Hanga Roa (Isla De Pascua)',
      generatedLabel: 'Fecha Hora Impresión: 07-10-2026 02:35',
      sheet: 'Synthetic',
      patients: [
        {
          sourceRow: 5,
          ordinal: 1,
          patientName: 'Paciente Sintético',
          clinicalRecord: 'FICHA-TEST',
          document: 'ID-TEST',
          diagnosis: 'Diagnóstico sintético',
          hospitalDays: '3',
          service: 'MQ',
          dischargeCondition: 'Vivo',
          days: Array.from({ length: 31 }, (_, i) => ({
            sourceDay: i + 1,
            sourceColumn: i + 12,
            sourceDate: `2026-10-${String(i + 1).padStart(2, '0')}`,
            originalValue: i === 0 ? 'C2' : '',
            category: i === 0 ? 'C2' : null,
            state: i === 0 ? ('category' as const) : ('blank' as const),
          })),
        },
      ],
    },
  };
  request.file.base64 = supplementBytes(request.report);
  return request;
};
