// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatClockTimeHHMM,
  getCurrentClockTimeHHMM,
} from '@/features/census/controllers/censusClockController';
import { getTimeRoundedToStep } from '@/utils/dateRangeUtils';
import {
  buildSystemHealthIncidentRows,
  buildSystemHealthIncidentTimeline,
  filterSystemHealthStatsForTriage,
} from '@/features/admin/components/systemHealthIncidentUtils';
import { baseStatus } from '@/tests/features/admin/systemHealthIncidentTestFixtures';
import { serializeEloisaPatientPayload } from '@/features/rayen-manual-import/domain/eloisaPatientCode';
import { buildOperationalTelemetryAlert } from '@/services/observability/operationalTelemetryIngestPolicy';
import { sanitizeOperationalTelemetryEvent } from '@/services/observability/operationalTelemetryPrivacy';

const evening = new Date('2026-10-25T04:30:00Z');
const user = baseStatus({
  lastSeen: evening.toISOString(),
  recentEvents: [
    {
      id: 'synthetic-clock',
      source: 'operational',
      category: 'sync',
      severity: 'warning',
      status: 'open',
      timestamp: evening.toISOString(),
      message: 'INCIDENTE SINTETICO',
    },
  ],
});

describe('hospital calendar consumers', () => {
  it('shows the census clock at 23:30 when the device reads 01:30', () => {
    expect(formatClockTimeHHMM(evening)).toBe('23:30');
    expect(getCurrentClockTimeHHMM(() => evening)).toBe('23:30');
  });
  it('rounds movement proposals on the hospital clock across midnight', () => {
    expect(getTimeRoundedToStep(new Date('2026-10-25T04:32:00Z'))).toBe('23:30');
    expect(getTimeRoundedToStep(new Date('2026-10-25T04:58:00Z'))).toBe('00:00');
  });
  it('filters evening incidents by hospital day', () => {
    const filters = {
      searchTerm: '',
      dateRange: 'day',
      severity: 'all',
      eventType: 'all',
    } as const;
    expect(
      filterSystemHealthStatsForTriage([user], { ...filters, selectedDate: '2026-10-24' })
    ).toEqual([user]);
    expect(
      filterSystemHealthStatsForTriage([user], { ...filters, selectedDate: '2026-10-25' })
    ).toEqual([]);
  });
  it('groups evening incidents into the hospital timeline day', () => {
    expect(buildSystemHealthIncidentTimeline(buildSystemHealthIncidentRows(user))).toEqual([
      expect.objectContaining({ date: '2026-10-24' }),
    ]);
  });
  it('rejects an admission after the hospital capture day', () => {
    expect(() =>
      serializeEloisaPatientPayload({
        version: 2,
        capturedAt: evening.toISOString(),
        encounterId: '99999',
        firstName: 'SINTETICO',
        lastName: 'RELOJ',
        rut: '000000000',
        admissionDate: '2026-10-25',
        devices: [],
        deviceEntries: [],
      })
    ).toThrow();
  });
  it('labels an undated operational alert with the hospital event day', () => {
    const event = sanitizeOperationalTelemetryEvent({
      category: 'sync',
      status: 'failed',
      operation: 'sync_queue_task_failure',
      timestamp: evening.toISOString(),
      issues: [],
      context: {},
    });
    expect(buildOperationalTelemetryAlert(event, 'SYNTHETIC').subject).toBe(
      '[HHR] FALLO · sync_queue_task_failure · 2026-10-24'
    );
  });
});
