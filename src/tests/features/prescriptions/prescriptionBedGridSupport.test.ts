import { describe, expect, it } from 'vitest';

import {
  buildBedRows,
  isStockRecord,
  isUnassignedRecord,
} from '@/features/prescriptions/components/prescriptionBedGridSupport';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
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
