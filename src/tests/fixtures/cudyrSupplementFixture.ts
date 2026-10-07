/** Entirely synthetic documentary evidence; signature bytes are not a full XLS. */
export const supplementRequest = () => ({
  kind: 'import-monthly-supplement',
  schemaVersion: 1,
  confirmed: true,
  operationId: '00000000-0000-4000-8000-000000000001',
  file: { name: 'synthetic.xls', base64: '0M8R4KGxGuE=' },
  report: {
    schemaVersion: 1,
    source: 'eloisa_monthly_report',
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
          state: i === 0 ? 'category' : 'blank',
        })),
      },
    ],
  },
});
