import { applyPendingExplicitCensusPatch } from './dailyRecordPendingPatchController';
import { replaceEqualDeep } from '@tanstack/react-query';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';

class PointReadPublication implements DailyRecordQueryResult {
  record: DailyRecordQueryResult['record'];
  runtime: DailyRecordQueryResult['runtime'];
  #retained: boolean;
  readonly #expected: DailyRecordQueryResult | undefined;
  readonly #current: () => DailyRecordQueryResult | undefined;
  readonly #confirm: (result: DailyRecordQueryResult) => void;
  readonly #mayConfirm: boolean;

  constructor(
    result: DailyRecordQueryResult,
    expected: DailyRecordQueryResult | undefined,
    current: () => DailyRecordQueryResult | undefined,
    confirm: (result: DailyRecordQueryResult) => void,
    mayConfirm: boolean
  ) {
    this.record = result.record;
    this.runtime = result.runtime;
    this.#expected = expected;
    this.#current = current;
    this.#confirm = confirm;
    this.#mayConfirm = mayConfirm;
    this.#retained = !mayConfirm;
  }

  get retained(): boolean {
    return this.#retained;
  }

  publish(): DailyRecordQueryResult {
    const current = this.#current();
    if (current && !arePatchValuesDeepEqual(current.record, this.#expected?.record)) {
      this.record = current.record;
      this.runtime = current.runtime;
      this.#retained = true;
      return current;
    }
    const accepted = replaceEqualDeep(current, { record: this.record, runtime: this.runtime });
    if (this.#mayConfirm) this.#confirm(accepted);
    const record = accepted.record
      ? applyPendingExplicitCensusPatch(
          accepted.runtime.date,
          accepted.record,
          current?.record ?? undefined
        )
      : accepted.record;
    const published =
      record === accepted.record
        ? accepted
        : {
            record,
            runtime: {
              ...accepted.runtime,
              baseSource: accepted.runtime.baseSource ?? accepted.runtime.sourceOfTruth,
              sourceOfTruth: 'local' as const,
            },
          };
    this.record = published.record;
    this.runtime = published.runtime;
    return published;
  }
}

export const createPointReadPublication = (
  result: DailyRecordQueryResult,
  expected: DailyRecordQueryResult | undefined,
  current: () => DailyRecordQueryResult | undefined,
  confirm: (result: DailyRecordQueryResult) => void,
  mayConfirm: boolean
): DailyRecordQueryResult =>
  new PointReadPublication(result, expected, current, confirm, mayConfirm);

/** Fetch results settle before QueryClient commits them; admission belongs in setData. */
export const publishDailyRecordQueryData = (previous: unknown, incoming: unknown): unknown =>
  incoming instanceof PointReadPublication
    ? incoming.publish()
    : replaceEqualDeep(previous, incoming);

export const retainedPointReadPublication = (result: DailyRecordQueryResult): boolean =>
  result instanceof PointReadPublication && result.retained;
