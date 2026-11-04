import { describe, expect, it } from 'vitest';
import { OPERATIONAL_TELEMETRY_PROBE_OPERATION } from '@/services/observability/operationalTelemetryPrivacy';
import { shouldAlertOperationalTelemetry } from '@/services/observability/operationalTelemetryIngestPolicy';

describe('who gets an email for an operational event', () => {
  it('mails a failure that needs a person', () => {
    expect(shouldAlertOperationalTelemetry({ status: 'failed', operation: 'rayen_sync_run' })).toBe(
      true
    );
  });

  it.each([
    ['without permission to save', ['auth_issue']],
    ['with an unexplained cause', ['unclassified_issue']],
    ['unreachable and also with a schema problem', ['unavailable_issue', 'schema_issue']],
  ])('mails an Eloísa sync that failed %s', (_case, issues) => {
    expect(
      shouldAlertOperationalTelemetry({ status: 'failed', operation: 'rayen_sync_run', issues })
    ).toBe(true);
  });

  it.each([
    ['Eloísa or the extension was unreachable', ['unavailable_issue']],
    ['the capture ran out of time', ['timeout_issue']],
    ['both', ['unavailable_issue', 'timeout_issue']],
  ])('only logs an Eloísa sync that failed because %s', (_case, issues) => {
    expect(
      shouldAlertOperationalTelemetry({ status: 'failed', operation: 'rayen_sync_run', issues })
    ).toBe(false);
  });

  it('still mails an unreachable source outside the Eloísa sync', () => {
    expect(
      shouldAlertOperationalTelemetry({
        status: 'failed',
        operation: 'send_census_email',
        issues: ['unavailable_issue'],
      })
    ).toBe(true);
  });

  it('only logs a section that could not load, since it offers its own reload', () => {
    expect(
      shouldAlertOperationalTelemetry({
        status: 'failed',
        operation: 'chunk_load_recovery',
        issues: ['unavailable_issue'],
      })
    ).toBe(false);
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
