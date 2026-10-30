import { describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import { executeUpdateHandoffChecklist } from '@/application/handoff';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildInitializedDayRecord } from '@/services/repositories/dailyRecordInitializationSupport';
import { parseDailyRecordWithDefaults, safeParseDailyRecord } from '@/schemas/zodSafeParsers';
import { addStaffAndChecklist, addNovedadesSection } from '@/services/pdf/handoffPdfLayoutSections';
import { createConflictResolutionTraceContext } from '@/services/repositories/conflictResolutionTrace';
import { mergeRecordObjectFields } from '@/services/repositories/conflictResolutionRecordObjectMergeUtils';

const createDailyRecordFixture = (overrides: Partial<DailyRecord> = {}) =>
  DataFactory.createMockDailyRecord(overrides.date ?? '2026-10-29', overrides);

const shared = { crashCartReviewDate: '2026-10-29', crashCartCode: '00123456' };
const createRecord = () =>
  createDailyRecordFixture({ date: '2026-10-31', handoffSharedChecklist: { ...shared } });

describe('shared nursing handoff checklist', () => {
  it('patches only the edited shared field, preserving the date and shift checklists', async () => {
    const record = createRecord();
    const patchRecord = vi.fn().mockResolvedValue(undefined);
    const saveRecord = vi.fn();
    const result = await executeUpdateHandoffChecklist({
      record,
      patchRecord,
      saveRecord,
      shift: 'shared',
      field: 'crashCartCode',
      value: '00000001',
    });
    expect(result.status).toBe('success');
    expect(patchRecord).toHaveBeenCalledWith({
      'handoffSharedChecklist.crashCartCode': '00000001',
    });
    expect(saveRecord).not.toHaveBeenCalled();
    expect(result.data?.updatedRecord.handoffSharedChecklist).toEqual({
      ...shared,
      crashCartCode: '00000001',
    });
    expect(result.data?.updatedRecord.handoffDayChecklist).toEqual(record.handoffDayChecklist);
    expect(record.handoffSharedChecklist).toEqual(shared);
  });

  it('preserves the code on a full-save date update and supports explicitly clearing a field', async () => {
    const saveRecord = vi.fn().mockResolvedValue(undefined);
    const result = await executeUpdateHandoffChecklist({
      record: createRecord(),
      saveRecord,
      shift: 'shared',
      field: 'crashCartReviewDate',
      value: '',
    });
    expect(result.status).toBe('success');
    expect(saveRecord.mock.calls[0][0].handoffSharedChecklist).toEqual({
      ...shared,
      crashCartReviewDate: '',
    });
  });

  it.each(['1234567', '123456789', '1234abcd', true])(
    'rejects an invalid code (%s) without writing',
    async value => {
      const patchRecord = vi.fn();
      const saveRecord = vi.fn();
      const result = await executeUpdateHandoffChecklist({
        record: createRecord(),
        patchRecord,
        saveRecord,
        shift: 'shared',
        field: 'crashCartCode',
        value,
      });
      expect(result.status).toBe('failed');
      expect(patchRecord).not.toHaveBeenCalled();
      expect(saveRecord).not.toHaveBeenCalled();
    }
  );

  it.each(['2026-99-99', '2025-02-29', '2026-04-31', '29-10-2026'])(
    'rejects an impossible review date: %s',
    async value => {
      const patchRecord = vi.fn();
      const saveRecord = vi.fn();
      const outcome = await executeUpdateHandoffChecklist({
        record: createRecord(),
        patchRecord,
        saveRecord,
        shift: 'shared',
        field: 'crashCartReviewDate',
        value,
      });
      expect(outcome.status).toBe('failed');
      expect(patchRecord).not.toHaveBeenCalled();
      expect(saveRecord).not.toHaveBeenCalled();
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
