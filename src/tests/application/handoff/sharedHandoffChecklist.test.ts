import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { jsPDF } from 'jspdf';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { parseDailyRecordWithDefaults, safeParseDailyRecord } from '@/schemas/zodSafeParsers';
import { addStaffAndChecklist, addNovedadesSection } from '@/services/pdf/handoffPdfLayoutSections';
import { createConflictResolutionTraceContext } from '@/services/repositories/conflictResolutionTrace';
import { mergeRecordObjectFields } from '@/services/repositories/conflictResolutionRecordObjectMergeUtils';

const notifyError = vi.hoisted(() => vi.fn());
vi.mock('@/context/UIContext', () => ({ useNotification: () => ({ error: notifyError }) }));
vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({ logHandoffNovedadesModified: vi.fn(), userId: 'synthetic-user' }),
}));

import { useHandoffManagement } from '@/hooks/useHandoffManagement';

const createDailyRecordFixture = (overrides: Partial<DailyRecord> = {}) =>
  DataFactory.createMockDailyRecord(overrides.date ?? '2026-10-29', overrides);

const shared = { crashCartReviewDate: '2026-10-29', crashCartCode: '00123456' };
const createRecord = () =>
  createDailyRecordFixture({ date: '2026-10-31', handoffSharedChecklist: { ...shared } });

const editShared = (field: string, value: boolean | string) => {
  const patchRecord = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useHandoffManagement(createRecord(), patchRecord));
  notifyError.mockClear();
  result.current.updateHandoffChecklist('shared', field, value);
  return patchRecord;
};

describe('shared nursing handoff checklist', () => {
  it('patches only the edited shared field, leaving the date and shift checklists alone', () => {
    expect(editShared('crashCartCode', '00000001').mock.calls).toEqual([
      [{ 'handoffSharedChecklist.crashCartCode': '00000001' }],
    ]);
  });

  it('clears the review date explicitly without touching the code', () => {
    expect(editShared('crashCartReviewDate', '').mock.calls).toEqual([
      [{ 'handoffSharedChecklist.crashCartReviewDate': '' }],
    ]);
  });

  it.each(['1234567', '123456789', '1234abcd', true])(
    'rejects an invalid code (%s) without writing',
    value => {
      expect(editShared('crashCartCode', value)).not.toHaveBeenCalled();
      expect(notifyError).toHaveBeenCalledWith(
        'Error al guardar',
        'Revise la fecha del carro de paro y use un código de 8 dígitos.'
      );
    }
  );

  it.each(['2026-99-99', '2025-02-29', '2026-04-31', '29-10-2026'])(
    'rejects an impossible review date: %s',
    value => {
      expect(editShared('crashCartReviewDate', value)).not.toHaveBeenCalled();
      expect(notifyError).toHaveBeenCalledTimes(1);
      expect(
        safeParseDailyRecord({
          ...createRecord(),
          handoffSharedChecklist: { ...shared, crashCartReviewDate: value },
        })
      ).toBeNull();
    }
  );

  it.each([
    ['2026-10-29', '2026-10-30'],
    ['2026-10-31', '2026-11-01'],
    ['2026-12-31', '2027-01-01'],
    ['2028-02-29', '2028-03-01'],
  ])('copies and reloads the review from %s to %s without changing it', (from, to) => {
    const source = createDailyRecordFixture({ date: from, handoffSharedChecklist: { ...shared } });
    const copied = buildInitializedDayRecord(to, source);
    const reloaded = safeParseDailyRecord(JSON.parse(JSON.stringify(copied)));
    expect(reloaded?.handoffSharedChecklist).toEqual(shared);
    expect(reloaded?.date).toBe(to);
    const copiedChecklist = copied.handoffSharedChecklist;
    if (!copiedChecklist) throw new Error('Missing copied checklist');
    copiedChecklist.crashCartCode = '99999999';
    expect(source.handoffSharedChecklist).toEqual(shared);
    expect(buildInitializedDayRecord('2027-02-01', reloaded).handoffSharedChecklist).toEqual(
      shared
    );
  });

  it('keeps legacy days empty and salvages shared fields when another field is malformed', () => {
    expect(
      safeParseDailyRecord(createDailyRecordFixture())?.handoffSharedChecklist
    ).toBeUndefined();
    expect(buildInitializedDayRecord('2026-11-01', null).handoffSharedChecklist).toBeUndefined();
    const salvaged = parseDailyRecordWithDefaults(
      { ...createRecord(), discharges: 'invalid' },
      '2026-10-31'
    );
    expect(salvaged.handoffSharedChecklist).toEqual(shared);
  });

  it('merges independent shared fields without dropping either value', () => {
    const remote = createDailyRecordFixture({
      handoffSharedChecklist: { crashCartReviewDate: shared.crashCartReviewDate },
    });
    const local = createDailyRecordFixture({
      handoffSharedChecklist: { crashCartCode: shared.crashCartCode },
    });
    const result = mergeRecordObjectFields(
      remote,
      local,
      true,
      createConflictResolutionTraceContext()
    );
    expect(result.handoffSharedChecklist).toEqual(shared);
  });

  it.each(['day', 'night'] satisfies ('day' | 'night')[])(
    'includes shared data in the %s PDF even without a shift checklist',
    shift => {
      const record = createRecord();
      delete record.handoffDayChecklist;
      delete record.handoffNightChecklist;
      const doc = new jsPDF();
      const text = vi.spyOn(doc, 'text');
      addStaffAndChecklist(doc, record, shift, 10, 30);
      expect(text).toHaveBeenCalledWith(
        expect.stringContaining('29-10-2026'),
        10,
        expect.any(Number)
      );
      expect(text).toHaveBeenCalledWith(
        expect.stringContaining('Codigo: 00123456'),
        10,
        expect.any(Number)
      );
      addNovedadesSection(doc, 'Pendiente de revisión', 10, 60);
      expect(text).toHaveBeenCalledWith('Novedades & Pendientes', 10, expect.any(Number));
    }
  );
});
