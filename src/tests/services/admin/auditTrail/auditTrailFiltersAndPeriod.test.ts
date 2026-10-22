import { describe, expect, it } from 'vitest';
import { normalizeAuditTrailEvents } from '@/services/admin/auditTrail/auditTrailNormalize';
import {
  buildAuditTrailActorOptions,
  filterAuditTrailEvents,
  summarizeAuditTrail,
  type AuditTrailFilters,
} from '@/services/admin/auditTrail/auditTrailFilters';
import {
  buildAuditTrailPeriod,
  buildAuditTrailRange,
  formatAuditTrailPeriod,
  resolveAuditTrailQueryRange,
  shiftAuditTrailPeriod,
} from '@/services/admin/auditTrail/auditTrailPeriod';
import {
  DEFAULT_AUDIT_TRAIL_VIEW,
  parseAuditTrailViewPreferences,
  serializeAuditTrailViewPreferences,
} from '@/services/admin/auditTrail/auditTrailPreferences';
import {
  AUDIT_TRAIL_EVENT_EXPORT_HEADERS,
  buildAuditTrailEventExportRows,
} from '@/services/admin/auditTrail/auditTrailExportRows';
import { auditLog, patientDetails } from './auditTrailFixtures';

const events = normalizeAuditTrailEvents([
  auditLog({
    userId: 'ana.soto@hospital.test',
    userDisplayName: 'Ana Soto',
    details: patientDetails('José Pérez', {
      rut: '12.345.678-5',
      changes: { pathology: { old: 'Neumonía', new: 'Neumonía grave' } },
    }),
  }),
  auditLog({
    action: 'VIEW_PATIENT',
    userId: 'ana.soto@hospital.test',
    userDisplayName: 'Ana Soto',
    details: patientDetails('José Pérez'),
  }),
  auditLog({ action: 'PATIENT_CLEARED', details: patientDetails('María Rojas') }),
  auditLog({ action: 'USER_LOGIN', entityType: 'user' }),
  auditLog({ action: 'CONFLICT_AUTO_MERGED', entityType: 'dailyRecord', entityId: '2026-10-22' }),
]);

const filters = (overrides: Partial<AuditTrailFilters> = {}): AuditTrailFilters => ({
  categories: ['change', 'access', 'connection', 'system'],
  areas: [],
  reviewOnly: false,
  search: '',
  ...overrides,
});

describe('audit trail filters', () => {
  it('filters by category, review state and staff member', () => {
    expect(filterAuditTrailEvents(events, filters({ categories: ['change'] }))).toHaveLength(2);
    expect(
      filterAuditTrailEvents(events, filters({ reviewOnly: true })).map(event => event.label)
    ).toEqual(['Cama liberada']);
    expect(
      filterAuditTrailEvents(events, filters({ actorKey: 'ana.soto@hospital.test' }))
    ).toHaveLength(2);
  });

  it('searches patients, documents without punctuation, staff and values', () => {
    const search = (term: string) =>
      filterAuditTrailEvents(events, filters({ search: term })).length;
    expect(search('jose perez')).toBe(2);
    expect(search('12345678')).toBe(1);
    expect(search('ana')).toBe(2);
    expect(search('neumonía grave')).toBe(1);
    expect(search('h1c1')).toBe(3);
  });

  it('summarizes the period and lists staff by activity', () => {
    expect(summarizeAuditTrail(events, [])).toMatchObject({
      change: 2,
      access: 1,
      connection: 1,
      system: 1,
      review: 1,
      patients: 2,
      actors: 2,
    });
    expect(buildAuditTrailActorOptions(events)[0]).toMatchObject({
      name: 'Enfermera Uno',
      count: 3,
    });
  });
});

describe('audit trail period', () => {
  it('builds day, week and month windows that end on the chosen day', () => {
    expect(buildAuditTrailPeriod('day', '2026-10-22')).toMatchObject({
      startDate: '2026-10-22',
      endDate: '2026-10-22',
    });
    expect(buildAuditTrailPeriod('week', '2026-10-22').startDate).toBe('2026-10-16');
    expect(buildAuditTrailPeriod('month', '2026-10-22').startDate).toBe('2026-09-23');
    expect(buildAuditTrailRange('2026-10-22', '2026-10-01')).toMatchObject({
      startDate: '2026-10-01',
      endDate: '2026-10-22',
    });
  });

  it('queries whole Rapa Nui days and moves by the window length', () => {
    expect(resolveAuditTrailQueryRange(buildAuditTrailPeriod('day', '2026-10-22'))).toEqual({
      fromIso: '2026-10-22T05:00:00.000Z',
      toIso: '2026-10-23T05:00:00.000Z',
    });
    const week = shiftAuditTrailPeriod(buildAuditTrailPeriod('week', '2026-10-22'), -1);
    expect(week).toMatchObject({ startDate: '2026-10-09', endDate: '2026-10-15' });
    expect(formatAuditTrailPeriod(week)).toBe('09-10-2026 – 15-10-2026');
  });
});

describe('audit trail view preferences', () => {
  it('falls back to defaults and keeps only known values', () => {
    expect(parseAuditTrailViewPreferences(null)).toEqual(DEFAULT_AUDIT_TRAIL_VIEW);
    expect(parseAuditTrailViewPreferences('{')).toEqual(DEFAULT_AUDIT_TRAIL_VIEW);
    expect(
      parseAuditTrailViewPreferences(
        JSON.stringify({ grouping: 'session', categories: ['connection', 'x'], density: 'x' })
      )
    ).toMatchObject({ grouping: 'session', categories: ['connection'], density: 'compact' });

    const custom = {
      ...DEFAULT_AUDIT_TRAIL_VIEW,
      grouping: 'actor' as const,
      columns: { document: false, bed: true, device: true },
    };
    expect(parseAuditTrailViewPreferences(serializeAuditTrailViewPreferences(custom))).toEqual(
      custom
    );
  });
});

describe('audit trail export', () => {
  it('writes one row per change with day-month-year dates', () => {
    const rows = buildAuditTrailEventExportRows(events);
    const diagnosis = rows.find(row => row.includes('Diagnóstico'));
    expect(AUDIT_TRAIL_EVENT_EXPORT_HEADERS).toHaveLength(diagnosis?.length ?? 0);
    expect(diagnosis?.slice(0, 1)).toEqual(['22-10-2026']);
    expect(diagnosis).toEqual(expect.arrayContaining(['Neumonía', 'Neumonía grave', 'Ana Soto']));
    expect(rows).toHaveLength(events.length);
  });
});
