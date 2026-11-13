import { describe, expect, it } from 'vitest';

import {
  buildBedRows,
  isStockRecord,
  isUnassignedRecord,
  prescriptionBedRowKey,
} from '@/features/prescriptions/components/prescriptionBedGridSupport';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

const buildPrescription = (
  id: string,
  overrides: Partial<PrescriptionRecord> = {}
): PrescriptionRecord => ({
  id,
  hospitalId: 'hhr',
  prescriptionType: 'comun',
  assignmentScope: 'patient',
  bedId: 'H5C1',
  patientName: 'Paciente',
  patientRut: '11.111.111-1',
  image: {
    storagePath: `prescriptions/hhr/${id}/full.jpg`,
    thumbnailStoragePath: `prescriptions/hhr/${id}/thumb.jpg`,
    byteSize: 200_000,
    width: 1200,
    height: 900,
    contentType: 'image/jpeg',
  },
  uploader: { source: 'qr_pin' },
  createdAt: '2026-05-14T10:00:00.000Z',
  expiresAt: '2026-06-13T10:00:00.000Z',
  ...overrides,
});

const buildDailyRecord = (beds: DailyRecord['beds']): DailyRecord =>
  ({
    date: '2026-05-14',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '2026-05-14T12:00:00.000Z',
  }) as DailyRecord;

const patient = (bedId: string, patientName: string, rut: string): DailyRecord['beds'][string] =>
  ({
    bedId,
    patientName,
    rut,
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    age: '',
    pathology: '',
  }) as DailyRecord['beds'][string];

const idsInCell = (
  rows: ReturnType<typeof buildBedRows>,
  bedId: string,
  type: PrescriptionRecord['prescriptionType'] = 'comun'
): string[] => rows.find(row => row.bedId === bedId)?.byType[type].map(record => record.id) ?? [];

const countAssignedRecords = (rows: ReturnType<typeof buildBedRows>): number =>
  rows.reduce(
    (sum, row) =>
      sum +
      Object.values(row.byType).reduce((rowSum, prescriptions) => rowSum + prescriptions.length, 0),
    0
  );

describe('prescriptionBedGridSupport', () => {
  it('keeps a passport prescription under its own patient, never the matching RUT digits', () => {
    const rows = buildBedRows(
      buildDailyRecord({
        R2: patient('R2', 'Luna Sintetica', 'P123456785'),
        R1: patient('R1', 'Sol Sintetico', '12.345.678-5'),
      }),
      [
        buildPrescription('passport-rx', {
          bedId: 'R2',
          patientName: 'Luna Sintetica',
          patientRut: 'p123456785',
        }),
      ]
    );
    expect(idsInCell(rows, 'R1')).toEqual([]);
    expect(idsInCell(rows, 'R2')).toEqual(['passport-rx']);
  });

  it('follows a passport patient to the new bed, past the RUT patient with the same digits', () => {
    const rows = buildBedRows(
      buildDailyRecord({
        R1: patient('R1', 'Sol Sintetico', '12.345.678-5'),
        R5: patient('R5', 'Luna Sintetica', 'P123456785'),
      }),
      [
        buildPrescription('passport-rx', {
          bedId: 'R2',
          patientName: 'Luna Sintetica',
          patientRut: 'P123456785',
        }),
      ]
    );
    expect(idsInCell(rows, 'R1')).toEqual([]);
    expect(idsInCell(rows, 'R5')).toEqual(['passport-rx']);
  });

  it('never shows a RUT prescription on the passport patient now in that bed', () => {
    const rows = buildBedRows(
      buildDailyRecord({ R2: patient('R2', 'Luna Sintetica', 'P123456785') }),
      [
        buildPrescription('rut-rx', {
          bedId: 'R2',
          patientName: 'Sol Sintetico',
          patientRut: '12.345.678-5',
        }),
      ]
    );
    const holder = rows.find(row => row.byType.comun.some(record => record.id === 'rut-rx'));
    expect(holder?.patientName).toBe('Sol Sintetico');
    expect(holder?.isDischargeSnapshot).toBe(true);
  });

  it('places prescriptions by name when two patients only carry a no-document marker', () => {
    const rows = buildBedRows(
      buildDailyRecord({
        R1: patient('R1', 'Ana Inventada', 'SIN RUT'),
        R3: patient('R3', 'Bea Inventada', 'SIN RUT'),
      }),
      [
        buildPrescription('ana-rx', {
          bedId: 'R1',
          patientName: 'Ana Inventada',
          patientRut: 'SIN RUT',
        }),
      ]
    );
    expect(idsInCell(rows, 'R1')).toEqual(['ana-rx']);
    expect(idsInCell(rows, 'R3')).toEqual([]);
  });

  it('matches the same RUT in another format after a bed move', () => {
    const rows = buildBedRows(
      buildDailyRecord({ R1: patient('R1', 'Sol Sintetico', '12.345.678-5') }),
      [buildPrescription('rut-rx', { bedId: 'R2', patientRut: '123456785' })]
    );
    expect(rows).toHaveLength(1);
    expect(idsInCell(rows, 'R1')).toEqual(['rut-rx']);
  });

  it('keeps prescriptions visible after a home discharge using the last known bed snapshot', () => {
    const rows = buildBedRows(
      buildDailyRecord({
        H5C1: patient('H5C1', 'Nuevo Ocupante', '22.222.222-2'),
      }),
      [
        buildPrescription('rx-after-discharge', {
          bedId: 'H2C3',
          patientName: 'Paciente Alta Domicilio',
          patientRut: '12.345.678-9',
        }),
      ]
    );

    expect(idsInCell(rows, 'H2C3')).toEqual(['rx-after-discharge']);
    expect(rows.find(row => row.bedId === 'H2C3')).toMatchObject({
      patientName: 'Paciente Alta Domicilio',
      patientRut: '12.345.678-9',
      isDischargeSnapshot: true,
    });
  });

  it('groups a moved patient under the current bed even when the old bed is reused', () => {
    const rows = buildBedRows(
      buildDailyRecord({
        H2C2: patient('H2C2', 'Paciente Nuevo En Cama Antigua', '22.222.222-2'),
        H4C1: patient('H4C1', 'Paciente Trasladado', '11.111.111-1'),
      }),
      [
        buildPrescription('rx-before-transfer', {
          bedId: 'H2C2',
          patientName: 'Paciente Trasladado',
          patientRut: '11.111.111-1',
        }),
      ]
    );

    expect(idsInCell(rows, 'H4C1')).toEqual(['rx-before-transfer']);
    expect(idsInCell(rows, 'H2C2')).toEqual([]);
  });

  it('keeps multiple intraday prescriptions under the current bed after repeated bed changes', () => {
    const rows = buildBedRows(
      buildDailyRecord({
        H6C1: patient('H6C1', 'Paciente Cambios Multiples', '11.111.111-1'),
      }),
      [
        buildPrescription('rx-h1c1', {
          bedId: 'H1C1',
          patientName: 'Paciente Cambios Multiples',
          patientRut: '11.111.111-1',
          createdAt: '2026-05-14T09:00:00.000Z',
        }),
        buildPrescription('rx-h3c2', {
          bedId: 'H3C2',
          patientName: 'Paciente Cambios Multiples',
          patientRut: '11.111.111-1',
          createdAt: '2026-05-14T12:00:00.000Z',
        }),
      ]
    );

    expect(idsInCell(rows, 'H6C1')).toEqual(['rx-h1c1', 'rx-h3c2']);
    expect(rows).toHaveLength(1);
  });

  it('does not assign by name when a different RUT identifies a homonym in another bed', () => {
    const rows = buildBedRows(
      buildDailyRecord({
        H4C1: patient('H4C1', 'Paciente Homonimo', '22.222.222-2'),
      }),
      [
        buildPrescription('rx-homonym-source', {
          bedId: 'H2C2',
          patientName: 'Paciente Homonimo',
          patientRut: '11.111.111-1',
        }),
      ]
    );

    expect(idsInCell(rows, 'H4C1')).toEqual([]);
    expect(idsInCell(rows, 'H2C2')).toEqual(['rx-homonym-source']);
    expect(rows.find(row => row.bedId === 'H2C2')?.isDischargeSnapshot).toBe(true);
  });

  it('keeps incomplete identity prescriptions visible without forcing a wrong match', () => {
    const rows = buildBedRows(
      buildDailyRecord({
        H2C2: patient('H2C2', 'Paciente Activo', '22.222.222-2'),
      }),
      [
        buildPrescription('rx-incomplete-identity', {
          bedId: 'H7C1',
          patientName: 'Nombre Parcial',
          patientRut: undefined,
        }),
      ]
    );

    expect(idsInCell(rows, 'H7C1')).toEqual(['rx-incomplete-identity']);
    expect(rows.find(row => row.bedId === 'H7C1')).toMatchObject({
      patientName: 'Nombre Parcial',
      patientRut: '',
      isDischargeSnapshot: true,
    });
  });

  it('keeps the daily total intact across assigned, unassigned and hospitalized stock sections', () => {
    const assigned = Array.from({ length: 5 }, (_, index) =>
      buildPrescription(`rx-assigned-${index + 1}`, {
        bedId: `H${index + 1}C1`,
        patientName: `Paciente ${index + 1}`,
        patientRut: `11.111.111-${index + 1}`,
      })
    );
    const unassigned = [
      buildPrescription('rx-unassigned-1', {
        assignmentScope: 'unassigned',
        bedId: undefined,
        patientName: undefined,
        patientRut: undefined,
      }),
      buildPrescription('rx-unassigned-2', {
        assignmentScope: 'unassigned',
        bedId: undefined,
        patientName: undefined,
        patientRut: undefined,
      }),
    ];
    const stock = [
      buildPrescription('rx-stock', {
        assignmentScope: 'hospitalized_stock',
        bedId: undefined,
        patientName: undefined,
        patientRut: undefined,
      }),
    ];
    const records = [...assigned, ...unassigned, ...stock];
    const rows = buildBedRows(buildDailyRecord({}), records);

    expect(countAssignedRecords(rows)).toBe(5);
    expect(records.filter(isUnassignedRecord).map(record => record.id)).toEqual([
      'rx-unassigned-1',
      'rx-unassigned-2',
    ]);
    expect(records.filter(isStockRecord).map(record => record.id)).toEqual(['rx-stock']);
    expect(
      countAssignedRecords(rows) +
        records.filter(isUnassignedRecord).length +
        records.filter(isStockRecord).length
    ).toBe(8);
  });
});

describe('prescription grid patient retention', () => {
  it.each([false, true])('keeps current and discharged prescriptions, reversed=%s', reverse => {
    const current = buildPrescription('current', { bedId: 'R2' });
    const previous = buildPrescription('previous', {
      bedId: 'R2',
      patientName: 'Anterior Sintetico',
      patientRut: '10.000.013-K',
    });
    const records = reverse ? [previous, current] : [current, previous];
    const rows = buildBedRows(
      buildDailyRecord({ R2: patient('R2', 'Paciente', '11.111.111-1') }),
      records
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ patientName: 'Paciente', patientRut: '11.111.111-1' });
    expect(rows[0].byType.comun.map(record => record.id)).toEqual(['current']);
    expect(rows[1].isDischargeSnapshot).toBe(true);
    expect(rows[1].byType.comun.map(record => record.id)).toEqual(['previous']);
  });

  it.each(['11.111.111-2', 'P111111111'])(
    'retains both prescriptions after document correction to %s',
    corrected => {
      const rows = buildBedRows(buildDailyRecord({ R2: patient('R2', 'Paciente', corrected) }), [
        buildPrescription('before', { bedId: 'R2' }),
        buildPrescription('after', { bedId: 'R2', patientRut: corrected }),
      ]);
      expect(countAssignedRecords(rows)).toBe(2);
      expect(rows).toHaveLength(2);
      expect(rows[0].byType.comun.map(record => record.id)).toEqual(['after']);
      expect(rows[1].byType.comun.map(record => record.id)).toEqual(['before']);
    }
  );

  it.each([true, false])('groups each previous person separately, documents=%s', withDocuments => {
    const records = ['A', 'B', 'A'].map((name, index) =>
      buildPrescription(String(index), {
        bedId: 'R2',
        patientName: name,
        patientRut: withDocuments ? `P${name}123456` : 'SIN RUT',
      })
    );
    const rows = buildBedRows(
      buildDailyRecord({ R2: patient('R2', 'Actual Sintetico', '11.111.111-1') }),
      records
    );
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map(row => row.byType.comun.map(record => record.id))).toEqual([
      ['0', '2'],
      ['1'],
    ]);
    expect(countAssignedRecords(rows)).toBe(3);
  });
});

it('preserves every patient prescription and every occupied bed in 3200 generated scenarios', () => {
  let seed = 64123;
  const next = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  for (let scenario = 0; scenario < 3200; scenario++) {
    const beds: DailyRecord['beds'] = {};
    const records: PrescriptionRecord[] = [];
    const count = 1 + next(8);
    for (let personIndex = 0; personIndex < count; personIndex++) {
      const name = `Sintetico ${personIndex}`;
      const document = ['', 'SIN RUT', `P${personIndex}123456`, `${personIndex + 10}.000.013-K`][
        next(4)
      ];
      const currentBed = `R${personIndex + 1}`;
      if (next(3) !== 0) beds[currentBed] = patient(currentBed, name, document);
      for (let copy = 0; copy < 1 + next(4); copy++) {
        records.push(
          buildPrescription(`${personIndex}-${copy}`, {
            bedId: `R${1 + next(count + 2)}`,
            patientName: name,
            patientRut: copy === 0 && next(3) === 0 ? `CORRECTED${personIndex}` : document,
            prescriptionType: (['comun', 'psicotropicos', 'benzodiazepinas'] as const)[next(3)],
          })
        );
      }
    }
    for (let index = records.length - 1; index > 0; index--) {
      const other = next(index + 1);
      [records[index], records[other]] = [records[other], records[index]];
    }
    const rows = buildBedRows(buildDailyRecord(beds), records);
    const actualIds = rows
      .flatMap(row =>
        Object.values(row.byType)
          .flat()
          .map(record => record.id)
      )
      .sort();
    expect(actualIds, `scenario ${scenario}`).toEqual(records.map(record => record.id).sort());
    for (const [bedId, occupant] of Object.entries(beds)) {
      expect(rows.filter(row => row.bedId === bedId && !row.isDischargeSnapshot)).toMatchObject([
        { patientName: occupant.patientName, patientRut: occupant.rut },
      ]);
    }
  }
});

describe('a person who left an empty bed', () => {
  const withRut = (id: string) =>
    buildPrescription(id, {
      bedId: 'R4',
      patientName: 'Mar Inventado',
      patientRut: '10.000.013-K',
    });
  const withoutDocument = (id: string, patientRut?: string) =>
    buildPrescription(id, { bedId: 'R4', patientName: 'mar  inventado', patientRut });
  const orders = <T>(items: T[]): T[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, index) =>
          orders([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest])
        );

  it('stays in one row whether or not each prescription carries the document, in any order', () => {
    for (const records of orders([withRut('a'), withoutDocument('b', 'SIN RUT'), withRut('c')])) {
      const rows = buildBedRows(buildDailyRecord({}), records);
      expect(rows.map(row => [row.patientRut, row.byType.comun.length])).toEqual([
        ['10.000.013-K', 3],
      ]);
      expect(rows[0]?.byType.comun.map(record => record.id)).toEqual(
        records.map(record => record.id)
      );
    }
  });

  it('keeps a corrected document apart and does not guess for an undocumented namesake', () => {
    const corrected = buildPrescription('corrected', {
      bedId: 'R4',
      patientName: 'Mar Inventado',
      patientRut: '11.111.111-1',
    });
    for (const records of orders([withRut('a'), corrected, withoutDocument('b')])) {
      const rows = buildBedRows(buildDailyRecord({}), records);
      expect(rows.map(row => row.byType.comun.map(record => record.id)).sort()).toEqual([
        ['a'],
        ['b'],
        ['corrected'],
      ]);
      expect(new Set(rows.map(prescriptionBedRowKey)).size).toBe(3);
    }
  });
});
