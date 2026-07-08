import { describe, expect, it } from 'vitest';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const makeRecord = (date: string, lastUpdated: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated,
  nurses: [],
  activeExtraBeds: [],
});

describe('conflictResolutionMatrix census movement policies', () => {
  it('preserves diagnosis when an explicit bed move merges over an empty remote target bed', () => {
    const remote = makeRecord('2026-07-01', '2026-07-01T13:00:00.000Z');
    remote.beds = {
      H2C1: {
        bedId: 'H2C1',
        patientName: 'Pierre-jean',
        rut: '25DF52626',
        admissionDate: '2026-06-29',
        pathology: 'Celulitis pie izquierdo',
        location: 'Sala Hospitalizados',
      } as unknown as DailyRecord['beds'][string],
      H2C2: {
        bedId: 'H2C2',
        patientName: '',
        rut: '',
        pathology: '',
        location: 'Sala Hospitalizados',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-07-01', '2026-07-01T13:05:00.000Z');
    local.beds = {
      H2C1: {
        bedId: 'H2C1',
        patientName: '',
        rut: '',
        pathology: '',
        location: 'Sala Hospitalizados',
      } as unknown as DailyRecord['beds'][string],
      H2C2: {
        bedId: 'H2C2',
        patientName: 'Pierre-jean',
        rut: '25DF52626',
        admissionDate: '2026-06-29',
        pathology: 'Celulitis pie izquierdo',
        location: 'Sala Hospitalizados',
      } as unknown as DailyRecord['beds'][string],
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.H2C1', 'beds.H2C2'],
    });

    expect(resolved.beds.H2C2.patientName).toBe('Pierre-jean');
    expect(resolved.beds.H2C2.rut).toBe('25DF52626');
    expect(resolved.beds.H2C2.pathology).toBe('Celulitis pie izquierdo');
    expect(resolved.beds.H2C1.patientName).toBe('');
  });

  it('preserves an explicit bed move over an empty target bed with residual clinical defaults', () => {
    const remote = makeRecord('2026-07-01', '2026-07-01T13:00:00.000Z');
    remote.beds = {
      R5: {
        bedId: 'R5',
        patientName: 'Paciente Movimiento Local',
        rut: '55.555.555-5',
        admissionDate: '2026-06-30',
        pathology: 'Diagnostico a conservar',
        status: 'Estable',
        specialty: 'Med Interna',
        age: '40a',
      } as unknown as DailyRecord['beds'][string],
      R10: {
        bedId: 'R10',
        patientName: '',
        rut: '',
        admissionDate: '',
        pathology: '',
        status: 'Estable',
        specialty: 'Med Interna',
        age: '40a',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-07-01', '2026-07-01T13:05:00.000Z');
    local.beds = {
      R5: {
        ...remote.beds.R10,
        bedId: 'R5',
      },
      R10: {
        ...remote.beds.R5,
        bedId: 'R10',
      },
    };

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R5', 'beds.R10'],
    });

    expect(resolved.beds.R10.patientName).toBe('Paciente Movimiento Local');
    expect(resolved.beds.R10.rut).toBe('55.555.555-5');
    expect(resolved.beds.R10.pathology).toBe('Diagnostico a conservar');
    expect(resolved.beds.R5.patientName).toBe('');
  });

  it('merges movement arrays by id (union with local override)', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    remote.transfers = [
      { id: 't1', bedId: 'R1', patientName: 'A' },
      { id: 't2', bedId: 'R2', patientName: 'B' },
    ] as unknown as DailyRecord['transfers'];

    const local = makeRecord('2026-02-18', '2026-02-18T10:01:00.000Z');
    local.transfers = [
      { id: 't2', bedId: 'R2', patientName: 'B (local)' },
      { id: 't3', bedId: 'R3', patientName: 'C' },
    ] as unknown as DailyRecord['transfers'];

    const resolved = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['transfers'],
    });

    const ids = resolved.transfers.map(item => item.id);
    expect(ids).toEqual(['t1', 't2', 't3']);
    expect(resolved.transfers.find(item => item.id === 't2')?.patientName).toBe('B (local)');
  });
});
