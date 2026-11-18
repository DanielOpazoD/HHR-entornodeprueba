import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { buildCensusMasterBuffer } from '@/services/exporters/censusMasterWorkbook';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';

const discharges: DischargeData[] = [
  {
    id: 'd1',
    bedName: 'R1',
    bedId: 'R1',
    bedType: 'UTI',
    patientName: 'José Ñuñez Peña',
    rut: '12.345.678-5',
    diagnosis: 'Neumonía',
    time: '00:30',
    status: 'Vivo',
    dischargeType: 'Domicilio (Habitual)',
    age: '72',
  },
  {
    id: 'd2',
    bedName: '',
    bedId: 'H1C1',
    bedType: '',
    patientName: 'RN de María Ñandú',
    rut: 'P123456785',
    diagnosis: '',
    time: '23:59',
    status: 'Vivo',
    dischargeType: 'Otra',
    dischargeTypeOther: 'Hogar de acogida',
    age: '10d',
    isNested: true,
  },
  {
    id: 'd3',
    bedName: 'Cuna 2',
    bedId: 'H2C2',
    bedType: 'Cuna',
    patientName: '',
    rut: '',
    diagnosis: 'Ictericia',
    time: '',
    status: 'Fallecido',
    age: '',
  },
  {
    id: 'd-deleted',
    bedName: 'R2',
    bedId: 'R2',
    bedType: 'UTI',
    patientName: 'Borrado Ñ',
    rut: '11.111.111-1',
    diagnosis: 'No debe salir',
    time: '12:00',
    status: 'Vivo',
    deletedAt: '2026-11-18T03:00:00.000Z',
  },
];

const transfers: TransferData[] = [
  {
    id: 't1',
    bedName: 'R3',
    bedId: 'R3',
    bedType: 'UCI',
    patientName: 'Ángela Muñoz',
    rut: '10.000.013-K',
    diagnosis: 'Sepsis',
    time: '00:00',
    evacuationMethod: 'Aerocardal',
    receivingCenter: 'Hospital Salvador',
    receivingCenterOther: '',
    age: '5m',
  },
  {
    id: 't2',
    bedName: '',
    bedId: 'H3C1',
    bedType: '',
    patientName: 'Turista Pasaporte',
    rut: '1234567A',
    diagnosis: '',
    time: '23:30',
    evacuationMethod: '',
    receivingCenter: 'Otro',
    receivingCenterOther: 'Clínica Dávila',
  },
];

const cma: CMAData[] = [
  {
    id: 'c1',
    bedName: 'Pabellón',
    patientName: 'Iñaki Ríos',
    rut: '12A3456785',
    age: '40 a',
    diagnosis: 'Hernia inguinal',
    specialty: 'Cirugía',
    interventionType: 'Cirugía Mayor Ambulatoria',
  },
  {
    id: 'c2',
    bedName: 'Cuna 1',
    patientName: '',
    rut: '',
    age: '',
    diagnosis: '',
    specialty: '',
    interventionType: 'Procedimiento Médico Ambulatorio',
  },
];

const buildRecord = (
  date: string,
  movements: Pick<DailyRecord, 'discharges' | 'transfers' | 'cma'>
): DailyRecord => ({
  date,
  beds: {},
  ...movements,
  lastUpdated: `${date}T09:30:00Z`,
  nurses: [],
  activeExtraBeds: [],
});

/**
 * Dumps everything a person sees from the discharges title down: value, value type, full style and
 * merges, plus every column width. Read back from the saved .xlsx so serialization is covered too.
 */
const dumpMovementSections = (sheet: ExcelJS.Worksheet) => {
  let firstRow = -1;
  sheet.eachRow((row, rowNumber) => {
    if (firstRow < 0 && row.getCell(1).value === 'ALTAS DEL DÍA') firstRow = rowNumber;
  });
  expect(firstRow).toBeGreaterThan(0);

  const styles: string[] = [];
  const cells: string[] = [];
  for (let rowNumber = firstRow; rowNumber <= sheet.rowCount; rowNumber++) {
    sheet.getRow(rowNumber).eachCell({ includeEmpty: false }, cell => {
      const style = JSON.stringify(cell.style);
      if (!styles.includes(style)) styles.push(style);
      const offset = `${cell.address.replace(/\d+$/, '')}+${Number(cell.row) - firstRow}`;
      cells.push(
        `${offset} | ${String(cell.value)} | type ${cell.type} | s${styles.indexOf(style)}`
      );
    });
  }
  const merges = [...sheet.model.merges].sort();
  const widths = Array.from({ length: 15 }, (_, idx) => sheet.getColumn(idx + 1).width);
  return { firstRow, cells, styles, merges, widths };
};

const fixtureRecords = (): DailyRecord[] => [
  buildRecord('2026-11-17', { discharges, transfers, cma }),
  buildRecord('2026-11-18', { discharges: [], transfers: [], cma: [] }),
];

describe('census day sheet movement tables (characterization)', () => {
  it('keeps every discharge, transfer and CMA cell, style, merge and width', async () => {
    const buffer = await buildCensusMasterBuffer(fixtureRecords());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

    expect(dumpMovementSections(workbook.getWorksheet('17-11-2026')!)).toMatchSnapshot('with rows');
    expect(dumpMovementSections(workbook.getWorksheet('18-11-2026')!)).toMatchSnapshot('empty');
  });
});
