import React, { memo } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DailyRecordProvider,
  useDailyRecordBeds,
  useDailyRecordData,
  useDailyRecordMovements,
  useDailyRecordStaff,
} from '@/context/DailyRecordContext';
import type { DailyRecord, DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { useCensusMovementData } from '@/features/census/hooks/useCensusMovementData';
import { DataFactory } from '@/tests/factories/DataFactory';

const contextValue = (record: DailyRecord | null): DailyRecordContextType =>
  ({
    record,
    syncStatus: 'saved',
    lastSyncTime: null,
    bootstrapPhase: 'record_ready',
  }) as DailyRecordContextType;

const mountProbe = () => {
  const counts = {
    staff: vi.fn(),
    movements: vi.fn(),
    census: vi.fn(),
    beds: vi.fn(),
    data: vi.fn(),
  };
  const Staff = memo(function Staff() {
    counts.staff(useDailyRecordStaff());
    return null;
  });
  const Movements = memo(function Movements() {
    counts.movements(useDailyRecordMovements());
    return null;
  });
  const Census = memo(function Census() {
    counts.census(useCensusMovementData());
    return null;
  });
  const Beds = memo(function Beds() {
    counts.beds(useDailyRecordBeds());
    return null;
  });
  const Data = memo(function Data() {
    counts.data(useDailyRecordData());
    return null;
  });
  const children = (
    <>
      <Staff />
      <Movements />
      <Census />
      <Beds />
      <Data />
    </>
  );
  const renderProvider = (record: DailyRecord | null) => (
    <DailyRecordProvider value={contextValue(record)}>{children}</DailyRecordProvider>
  );
  let record = DataFactory.createMockDailyRecord('2026-10-01');
  const view = render(renderProvider(record));
  return {
    counts,
    record,
    update: (next: DailyRecord | null) => {
      if (next) record = next;
      view.rerender(renderProvider(next));
    },
  };
};

describe('daily record fragment rendering with the real provider', () => {
  it('keeps staff and movements stable across twenty bed/revision edits, while beds and full data update', () => {
    const { counts, record, update } = mountProbe();
    const bedId = Object.keys(record.beds)[0];
    for (let i = 1; i <= 20; i++) {
      update({
        ...record,
        lastUpdated: `2026-10-01T12:00:${String(i).padStart(2, '0')}Z`,
        beds: { ...record.beds, [bedId]: { ...record.beds[bedId], patientName: `Synthetic ${i}` } },
      });
    }
    expect(counts.staff).toHaveBeenCalledTimes(1);
    expect(counts.movements).toHaveBeenCalledTimes(1);
    expect(counts.census).toHaveBeenCalledTimes(1);
    expect(counts.beds).toHaveBeenCalledTimes(21);
    expect(counts.data).toHaveBeenCalledTimes(21);
    expect(counts.data.mock.lastCall?.[0].record.lastUpdated).toBe('2026-10-01T12:00:20Z');
  });

  it.each([
    'nursesDayShift',
    'nursesNightShift',
    'tensDayShift',
    'tensNightShift',
    'activeExtraBeds',
  ] as const)('publishes changed %s without notifying movements', field => {
    const { counts, record, update } = mountProbe();
    update({ ...record, [field]: ['changed'] });
    expect(counts.staff.mock.lastCall?.[0][field]).toEqual(['changed']);
    expect(counts.staff).toHaveBeenCalledTimes(2);
    expect(counts.movements).toHaveBeenCalledTimes(1);
  });

  it('publishes detailed staffing changes', () => {
    const { counts, record, update } = mountProbe();
    const staffingDetailsV1: NonNullable<DailyRecord['staffingDetailsV1']> = {
      day: { nurses: [], tens: [] },
      night: { nurses: [], tens: [] },
    };
    update({ ...record, staffingDetailsV1 });
    expect(counts.staff).toHaveBeenCalledTimes(2);
    expect(counts.staff.mock.lastCall?.[0].staffingDetailsV1).toBe(staffingDetailsV1);
  });

  it('publishes each movement collection and filters tombstones', () => {
    const { counts, record, update } = mountProbe();
    const next = {
      ...record,
      discharges: [DataFactory.createMockDischarge({ id: 'd' })],
      transfers: [DataFactory.createMockTransfer({ id: 't' })],
      cma: [DataFactory.createMockCMA({ id: 'c' })],
    };
    update(next);
    expect(counts.census.mock.lastCall?.[0]).toMatchObject({
      recordDate: record.date,
      discharges: [{ id: 'd' }],
      transfers: [{ id: 't' }],
      cma: [{ id: 'c' }],
    });
    update({
      ...next,
      discharges: next.discharges.map(x => ({ ...x, deletedAt: '2026-10-01T12:00:00Z' })),
    });
    expect(counts.census.mock.lastCall?.[0].discharges).toEqual([]);
    update({
      ...next,
      transfers: next.transfers.map(x => ({ ...x, deletedAt: '2026-10-01T12:00:00Z' })),
    });
    expect(counts.census.mock.lastCall?.[0].transfers).toEqual([]);
    update({ ...next, cma: next.cma.map(x => ({ ...x, deletedAt: '2026-10-01T12:00:00Z' })) });
    expect(counts.census.mock.lastCall?.[0].cma).toEqual([]);
  });

  it('updates the movement date and clears/restores fragments on a missing day', () => {
    const { counts, record, update } = mountProbe();
    update({ ...record, date: '2026-10-02' });
    expect(counts.census.mock.lastCall?.[0].recordDate).toBe('2026-10-02');
    update(null);
    expect(counts.staff.mock.lastCall?.[0]).toBeNull();
    expect(counts.movements.mock.lastCall?.[0]).toBeNull();
    expect(counts.census.mock.lastCall?.[0]).toMatchObject({
      recordDate: '',
      discharges: undefined,
    });
    update(record);
    expect(counts.census.mock.lastCall?.[0].recordDate).toBe(record.date);
  });
});
