import { describe, expectTypeOf, it } from 'vitest';
import type {
  ApplyDailyRecordPatch,
  ApplyDailyRecordPatchOptions,
  DailyRecord,
  DailyRecordDateRef,
  DailyRecordPatch,
  PersistDailyRecord,
} from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecord as RootDailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch as RootDailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecordDateRef as RootDailyRecordDateRef } from '@/types/domain/dailyRecordSlices';

describe('dailyRecordCoreContracts', () => {
  it('keeps application-facing daily record aliases aligned with root domain contracts', () => {
    expectTypeOf<DailyRecord>().toEqualTypeOf<RootDailyRecord>();
    expectTypeOf<DailyRecordPatch>().toEqualTypeOf<RootDailyRecordPatch>();
    expectTypeOf<DailyRecordDateRef>().toEqualTypeOf<RootDailyRecordDateRef>();
  });

  it('keeps persistence callbacks promise-based and patch-scoped', () => {
    expectTypeOf<ApplyDailyRecordPatch>().toEqualTypeOf<
      (patch: RootDailyRecordPatch, options?: ApplyDailyRecordPatchOptions) => Promise<void>
    >();
    expectTypeOf<PersistDailyRecord>().toEqualTypeOf<(record: RootDailyRecord) => Promise<void>>();
  });
});
