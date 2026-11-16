// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  VIEW_THROTTLE_WINDOW_MS,
  buildNextViewThrottleState,
  parseViewThrottleState,
  serializeViewThrottleState,
  shouldExcludeAuditEmail,
  shouldThrottleAuditViewAction,
} from '@/services/admin/auditViewThrottle';

describe('auditViewThrottle', () => {
  it('marks only institutional shared accounts as excluded from view audit', () => {
    expect(shouldExcludeAuditEmail('hospitalizados@hospitalhangaroa.cl')).toBe(true);
    expect(shouldExcludeAuditEmail('enfermeria.hospitalizados@hospitalhangaroa.cl')).toBe(true);
    expect(shouldExcludeAuditEmail('daniel.opazo@hospitalhangaroa.cl')).toBe(false);
    expect(shouldExcludeAuditEmail('doctor@hospital.cl')).toBe(false);
    expect(shouldExcludeAuditEmail(undefined)).toBe(false);
  });

  it('parses invalid serialized state defensively', () => {
    expect(parseViewThrottleState(null)).toEqual({});
    expect(parseViewThrottleState('')).toEqual({});
    expect(parseViewThrottleState('{invalid')).toEqual({});
    expect(parseViewThrottleState('"string"')).toEqual({});
  });

  it('serializes and updates throttle state only for VIEW actions', () => {
    const nextState = buildNextViewThrottleState('VIEW_PATIENT', {}, '2026-04-04T12:00:00.000Z');

    expect(parseViewThrottleState(serializeViewThrottleState(nextState))).toEqual({
      VIEW_PATIENT: '2026-04-04T12:00:00.000Z',
    });
    expect(buildNextViewThrottleState('USER_LOGIN', nextState, '2026-04-04T12:01:00.000Z')).toEqual(
      nextState
    );
  });

  it('throttles repeated VIEW actions inside the configured window', () => {
    const state = {
      VIEW_PATIENT: '2026-04-04T12:00:00.000Z',
    };

    expect(
      shouldThrottleAuditViewAction('VIEW_PATIENT', state, Date.parse('2026-04-04T12:10:00.000Z'))
    ).toBe(true);
    expect(
      shouldThrottleAuditViewAction(
        'VIEW_PATIENT',
        state,
        Date.parse('2026-04-04T12:15:00.000Z'),
        VIEW_THROTTLE_WINDOW_MS
      )
    ).toBe(false);
    expect(
      shouldThrottleAuditViewAction('USER_LOGIN', state, Date.parse('2026-04-04T12:15:00.000Z'))
    ).toBe(false);
  });
});
