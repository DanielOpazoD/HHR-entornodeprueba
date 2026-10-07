import { utils, write } from 'xlsx';
/** All fields are synthetic; these files never contain actual hospital data. */
export const reconciliationUpload = (kind: 'categories' | 'discharges') => {
  const rows =
    kind === 'categories'
      ? [
          ['MINISTERIO DE SALUD', 'Fecha Hora Impresión: 21-02-2026 12:00'],
          ['Hospital Hanga Roa (Isla De Pascua)', 'Categorización Riesgo Dependencia'],
          ['Mes consultado: Febrero de 2026'],
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
            'PACIENTE SINTÉTICO R1',
            'SYNTHETIC',
            '11.111.111-1',
            'Diagnóstico sintético',
            2,
            'MQ',
            'Vivo',
            ...Array.from({ length: 31 }, (_, i) => (i === 19 ? 'C3' : '')),
          ],
        ]
      : [
          ['MINISTERIO DE SALUD', 'Fecha Hora Impresión: 21-02-2026 12:00'],
          ['Lista de Pacientes con Alta Administrativa por Rango de Fecha'],
          ['Desde: 01-02-2026 Hasta: 28-02-2026'],
          [
            'Servicio',
            'Cama',
            'Nombre Paciente',
            'N° Ident.',
            'Fecha Egreso',
            'Diagnóstico Ingreso',
          ],
          [
            'MQ',
            'R1',
            'PACIENTE SINTÉTICO R1',
            '11.111.111-1',
            '20-02-2026 21:00',
            'Diagnóstico sintético',
          ],
        ];
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(rows), 'Synthetic');
  return {
    name: `synthetic-${kind}.xls`,
    mimeType: 'application/vnd.ms-excel',
    buffer: write(book, { type: 'buffer', bookType: 'biff8' }) as Buffer,
  };
};
