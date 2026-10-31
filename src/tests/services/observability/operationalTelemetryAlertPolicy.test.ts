import { describe, expect, it } from 'vitest';
import { OPERATIONAL_TELEMETRY_PROBE_OPERATION } from '@/services/observability/operationalTelemetryPrivacy';
import { shouldAlertOperationalTelemetry } from '@/services/observability/operationalTelemetryIngestPolicy';

describe('who gets an email for an operational event', () => {
  it('mails a failure that needs a person', () => {
    expect(shouldAlertOperationalTelemetry({ status: 'failed', operation: 'rayen_sync_run' })).toBe(
      true
    );
  });

  it('mails the controlled probe of the channel', () => {
    expect(
      shouldAlertOperationalTelemetry({
        status: 'failed',
        operation: OPERATIONAL_TELEMETRY_PROBE_OPERATION,
      })
    ).toBe(true);
  });

  it.each([
    ['a partial Eloísa sync', 'partial', 'rayen_sync_run'],
    ['a freshness check that recovers by itself', 'degraded', 'daily_record_resume_refresh_failed'],
    [
      'clinical inputs waiting for a confirmed read',
      'degraded',
      'daily_record_clinical_inputs_block_failed',
    ],
  ] as const)('only logs %s', (_case, status, operation) => {
    expect(shouldAlertOperationalTelemetry({ status, operation })).toBe(false);
  });
});
