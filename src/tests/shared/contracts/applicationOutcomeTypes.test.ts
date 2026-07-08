import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  hasApplicationIssues,
  isApplicationOutcomeNonFailure,
  isApplicationOutcomeSuccess,
  type ApplicationOutcome,
  type ApplicationOutcomeMetadata,
  type ApplicationOutcomeSeverity,
  type ApplicationOutcomeStatus,
  type ApplicationErrorKind,
  type ApplicationIssue,
  type UseCase,
} from '@/shared/contracts/applicationOutcomeTypes';

describe('applicationOutcomeTypes helpers', () => {
  const createOutcome = <T>(status: ApplicationOutcome<T>['status']): ApplicationOutcome<T> => ({
    status,
    data: null as T,
    issues: status === 'success' ? [] : [{ kind: 'unknown', message: 'Issue' }],
  });

  it('detects success outcomes precisely', () => {
    expect(isApplicationOutcomeSuccess(createOutcome('success'))).toBe(true);
    expect(isApplicationOutcomeSuccess(createOutcome('partial'))).toBe(false);
    expect(isApplicationOutcomeSuccess(createOutcome('failed'))).toBe(false);
  });

  it('detects non-failure outcomes across success partial and degraded', () => {
    expect(isApplicationOutcomeNonFailure(createOutcome('success'))).toBe(true);
    expect(isApplicationOutcomeNonFailure(createOutcome('partial'))).toBe(true);
    expect(isApplicationOutcomeNonFailure(createOutcome('degraded'))).toBe(true);
    expect(isApplicationOutcomeNonFailure(createOutcome('failed'))).toBe(false);
  });

  it('reports whether an outcome carries issues', () => {
    expect(hasApplicationIssues(createOutcome('success'))).toBe(false);
    expect(hasApplicationIssues(createOutcome('failed'))).toBe(true);
  });

  it('keeps outcome status and issue metadata unions explicit', () => {
    expectTypeOf<ApplicationOutcomeStatus>().toEqualTypeOf<
      'success' | 'partial' | 'degraded' | 'failed'
    >();
    expectTypeOf<ApplicationOutcomeSeverity>().toEqualTypeOf<
      'info' | 'warning' | 'error' | 'critical'
    >();
    expectTypeOf<ApplicationErrorKind>().toEqualTypeOf<
      'validation' | 'permission' | 'not_found' | 'conflict' | 'remote_blocked' | 'unknown'
    >();
    expectTypeOf<ApplicationIssue>().toMatchTypeOf<ApplicationOutcomeMetadata>();
  });

  it('keeps use cases returning application outcomes asynchronously', () => {
    type DemoUseCase = UseCase<{ id: string }, { ok: boolean }>;

    expectTypeOf<DemoUseCase['execute']>().toEqualTypeOf<
      (input: { id: string }) => Promise<ApplicationOutcome<{ ok: boolean }>>
    >();
  });
});
