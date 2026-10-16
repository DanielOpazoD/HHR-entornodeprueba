import type { Worksheet } from 'exceljs';
import type { CudyrSourceSheet } from './cudyrSourceTypes';
import { parseCudyrSupplementMatrix } from './cudyrSupplementParser';
import { CUDYR_SOURCE_COLUMNS as columns } from './cudyrSourceColumns';

/** Check original episodes and values independently of the presentation projection. */
export const validateCudyrSourceSheet = (
  sheet: Worksheet,
  source: CudyrSourceSheet,
  excerpt: boolean
) => {
  const parsed = parseCudyrSupplementMatrix(source.matrix);
  if (!parsed.ok) {
    // Unrecognized legacy layouts are copied verbatim, not projected into this table.
    if (!excerpt) return;
    throw new Error('No se pudo comprobar el extracto de Eloísa.');
  }
  if (parsed.report.month !== source.month)
    throw new Error('El mes del informe de Eloísa no coincide con el archivo guardado.');
  const fail = () => {
    throw new Error('El Excel no conserva todos los episodios y valores de Eloísa.');
  };
  const patients = parsed.report.patients.filter(
    p => !excerpt || p.days.some(d => d.sourceDay === 1 && d.originalValue)
  );
  const days = excerpt ? 1 : parsed.report.patients[0].days.length;
  if (sheet.rowCount !== patients.length + 6 || sheet.columnCount !== 8 + days) fail();
  patients.forEach((patient, index) => {
    const row = sheet.getRow(index + 2);
    const identity = [
      [1, patient.ordinal],
      [2, patient.patientName],
      [3, patient.document],
      [5, patient.diagnosis],
      [7, patient.service],
      [8, patient.dischargeCondition],
    ] as const;
    for (const [column, expected] of identity)
      if (row.getCell(column).text !== String(expected)) fail();
    for (const day of patient.days.filter(d => !excerpt || d.sourceDay === 1)) {
      const column = columns.firstDay + day.sourceDay - 1;
      if (sheet.getCell(1, column).text !== `Día ${day.sourceDay}`) fail();
      const value = row.getCell(column).value;
      // Only the explicitly added movement runs may be removed, never source content.
      const original =
        value && typeof value === 'object' && 'richText' in value
          ? value.richText
              .filter(run => !['▼ ', '▲ '].includes(run.text))
              .map(run => run.text)
              .join('')
          : row.getCell(column).text;
      if (original !== day.originalValue) fail();
    }
  });
};
