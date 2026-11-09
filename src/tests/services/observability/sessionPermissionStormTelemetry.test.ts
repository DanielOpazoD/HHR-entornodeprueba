import { describe, expect, it } from 'vitest';

import { sanitizeOperationalTelemetryContextValues } from '@/services/observability/operationalTelemetryPrivacy';
import { shouldAlertOperationalTelemetry } from '@/services/observability/operationalTelemetryIngestPolicy';

describe('permission storm telemetry', () => {
  it('a permission storm reaches the server with its counts, code and second opinion, not its labels', () => {
    const { context } = sanitizeOperationalTelemetryContextValues({
      sources: ['catalog:nurse catalog', 'records:subscribeToRecord'],
      codes: ['permission-denied', 'unauthenticated'],
      count: 2,
      catalogDenialCount: 1,
      recordDenialCount: 1,
      errorCode: 'unauthenticated',
      mixedDenialCodes: true,
      probeOutcome: 'readable',
    });

    expect(context).toEqual({
      count: 2,
      catalogDenialCount: 1,
      recordDenialCount: 1,
      errorCode: 'unauthenticated',
      mixedDenialCodes: true,
      probeOutcome: 'readable',
    });
  });

  it('never mails a permission storm, recovered or not', () => {
    for (const operation of [
      'session_permission_storm_logout',
      'session_permission_storm_recovered',
    ]) {
      expect(shouldAlertOperationalTelemetry({ operation, status: 'degraded' })).toBe(false);
    }
  });
});
