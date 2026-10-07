import type { Workbook } from 'exceljs';
import type { ArchivedCudyrSupplement } from './cudyrSupplementService';
import { addCudyrDataSheet } from './cudyrDataSheet';
export const addCudyrSupplementWorkbook = (
  workbook: Workbook,
  reports: ArchivedCudyrSupplement[],
  from: string,
  to: string
) => {
  addCudyrDataSheet(
    workbook,
    'Respaldo mensual Eloísa',
    [
      'Mes fuente',
      'Día fuente (sin ajuste HHR)',
      'Nombre completo fuente',
      'RUT o documento fuente',
      'Diagnóstico fuente',
      'Ficha clínica (no episodio)',
      'Servicio fuente',
      'Condición alta fuente',
      'Días hospitalización fuente',
      'Valor original',
      'Estado de celda',
      'Archivo',
      'Hoja',
      'Fila fuente',
      'Columna fuente',
      'Fecha impresión literal',
      'Importador (no autor CUDYR)',
      'Importado en HHR ISO',
      'Versión',
      'Contenido equivalente ID',
      'SHA-256 original',
      'Uso',
    ],
    reports.flatMap(a =>
      a.report.patients.flatMap(p =>
        p.days
          .filter(d => d.sourceDate >= from && d.sourceDate <= to)
          .map(d => [
            a.month,
            d.sourceDate,
            p.patientName,
            p.document,
            p.diagnosis,
            p.clinicalRecord,
            p.service,
            p.dischargeCondition,
            p.hospitalDays,
            d.originalValue,
            d.state === 'category'
              ? 'Categoría informada'
              : d.state === 'uncategorized'
                ? 'S/C explícito'
                : 'Celda vacía',
            a.file.name,
            a.report.sheet,
            p.sourceRow,
            d.sourceColumn,
            a.report.generatedLabel,
            a.importedBy.name,
            a.importedAt,
            a.id,
            a.contentId,
            a.file.sha256,
            'Sólo respaldo; episodio, cama, autor y hora no acreditados. No suma al reporte principal.',
          ])
      )
    )
  );
  addCudyrDataSheet(
    workbook,
    'Archivos complementarios',
    ['Archivo', 'Mes', 'Versión', 'SHA-256', 'Importado ISO', 'Importador', 'Estado de lectura'],
    reports.length
      ? reports.map(a => [
          a.file.name,
          a.month,
          a.id,
          a.file.sha256,
          a.importedAt,
          a.importedBy.name,
          'Informe importado por usuario; sin verificación de episodio',
        ])
      : [['Sin archivos guardados', from.slice(0, 7), '', '', '', '', 'Lectura completada en HHR']]
  );
};
