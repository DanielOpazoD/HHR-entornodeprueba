// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildMigrationInventory,
  censusDocuments,
  inventoryDigest,
  SOURCE_PROJECT,
  TARGET_PROJECT,
} from '../../../scripts/migration/inventoryCore.mjs';
import {
  collectMigrationInventory,
  makeInventoryReader,
  runInventoryCli,
} from '../../../scripts/migration/readInventory.mjs';

const wire = (value: unknown): object =>
  typeof value === 'string'
    ? { stringValue: value }
    : {
        mapValue: {
          fields: Object.fromEntries(
            Object.entries(value as object).map(([key, item]) => [key, wire(item)])
          ),
        },
      };
const doc = (project: string, date = '2026-09-19', beds = {}) => ({
  name: `projects/${project}/databases/(default)/documents/hospitals/hanga_roa/dailyRecords/${date}`,
  updateTime: '2026-10-15T00:00:00Z',
  fields: { date: wire(date), beds: wire(beds) },
});
const official = Object.fromEntries(
  ['2026-08', '2026-09'].map(month => [
    month,
    { version: 'fixture-version', updateTime: '2026-10-09T00:00:00Z' },
  ])
);
const input = () => ({
  source: [doc(SOURCE_PROJECT)],
  target: [doc(TARGET_PROJECT)],
  sourceAfter: [doc(SOURCE_PROJECT)],
  targetAfter: [doc(TARGET_PROJECT)],
  officialBefore: official,
  officialAfter: official,
  observedAt: '2026-10-15T00:00:00Z',
});

describe('migration inventory', () => {
  it('reports equal stored fields without authorizing migration', () => {
    const report = buildMigrationInventory(input());
    expect(report.days[0].comparison).toBe('equal_stored_fields');
    expect(report.canUseForPlanning).toBe(true);
    expect(report.authorizesMigration).toBe(false);
    expect(report.checks.cloudWrites).toBe(0);
  });
  it('keeps private content out of the report and counts orphan cribs', () => {
    const args = input();
    args.source = [
      doc(SOURCE_PROJECT, '2026-09-19', {
        R1: {
          patientName: 'PRIVATE_NAME',
          rut: 'PRIVATE_DOCUMENT',
          handoffNoteDayShift: 'PRIVATE_NOTE',
        },
        R2: {
          clinicalCrib: { patientName: 'PRIVATE_NEWBORN', handoffNoteNightShift: 'PRIVATE_NOTE' },
        },
      }),
    ];
    const before = structuredClone(args);
    const report = buildMigrationInventory(args);
    expect(report.days[0].source).toMatchObject({
      occupiedBeds: 1,
      nestedCribs: 1,
      nursingTextFields: 2,
    });
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_/);
    expect(args).toEqual(before);
    expect(report.days[0].comparison).toBe('different_stored_fields');
  });
  it.each(['changed', 'added', 'removed'])(
    'rejects a %s document during the read window',
    change => {
      const args = input();
      if (change === 'changed') args.targetAfter[0].updateTime = '2026-10-15T01:00:00Z';
      if (change === 'added') args.targetAfter.push(doc(TARGET_PROJECT, '2026-09-20'));
      if (change === 'removed') args.targetAfter = [];
      expect(buildMigrationInventory(args).canUseForPlanning).toBe(false);
    }
  );
  it('holds missing or changed protected CUDYR metadata', () => {
    const args = input();
    args.officialAfter = {};
    expect(buildMigrationInventory(args).checks.officialCudyrUnchanged).toBe(false);
    args.officialBefore = {};
    expect(buildMigrationInventory(args).canUseForPlanning).toBe(false);
    args.officialBefore = official;
    args.officialAfter = {
      ...official,
      '2026-08': { version: 'new', updateTime: '2026-10-09T00:00:00Z' },
    };
    expect(buildMigrationInventory(args).canUseForPlanning).toBe(false);
  });
  it('preserves source-only and target-only days as diagnostic facts', () => {
    const args = input();
    args.target = [doc(TARGET_PROJECT, '2026-09-20')];
    args.targetAfter = args.target;
    expect(buildMigrationInventory(args).days.map(day => day.comparison)).toEqual([
      'source_only_review',
      'target_only_preserved',
    ]);
  });
  it('rejects wrong roots, invalid dates, mismatched dates and duplicates', () => {
    expect(() => censusDocuments([doc(SOURCE_PROJECT)], TARGET_PROJECT)).toThrow();
    expect(() => censusDocuments([doc(SOURCE_PROJECT, '2026-02-30')], SOURCE_PROJECT)).toThrow();
    const mismatch = doc(SOURCE_PROJECT);
    mismatch.fields.date = wire('2026-09-20');
    expect(() => censusDocuments([mismatch], SOURCE_PROJECT)).toThrow();
    expect(() =>
      censusDocuments([doc(SOURCE_PROJECT), doc(SOURCE_PROJECT)], SOURCE_PROJECT)
    ).toThrow();
  });
  it('hashes object keys canonically while preserving array order', () => {
    expect(inventoryDigest({ a: 1, b: 2 })).toBe(inventoryDigest({ b: 2, a: 1 }));
    expect(inventoryDigest([1, 2])).not.toBe(inventoryDigest([2, 1]));
  });
  it('uses only GET with redirects forbidden and refuses foreign projects', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const read = makeInventoryReader('test-token-placeholder', fetcher);
    await expect(read('https://example.test/')).rejects.toThrow();
    await expect(
      read('https://firestore.googleapis.com/v1/projects/production/databases/(default)/documents/')
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await read(
      `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT}/databases/(default)/documents/hospitals/hanga_roa/dailyRecords`
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'error' });
  });
  it('rejects an unexpected project number before obtaining credentials or reading', async () => {
    const runGcloud = vi.fn(() =>
      JSON.stringify({
        projectId: SOURCE_PROJECT,
        projectNumber: 'wrong',
        lifecycleState: 'ACTIVE',
      })
    );
    const fetcher = vi.fn();
    await expect(collectMigrationInventory({ runGcloud, fetchImpl: fetcher })).rejects.toThrow(
      'migration_project_identity_mismatch'
    );
    expect(runGcloud).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['wrong_month', 'missing_version', 'missing_document', 'invalid_types'])(
    'reports unavailable protected evidence: %s',
    problem => {
      const runGcloud = (args: string[]) =>
        args[0] === 'auth'
          ? 'test-token-placeholder'
          : JSON.stringify({
              projectId: args[2],
              projectNumber: args[2] === SOURCE_PROJECT ? '179072085914' : '339724354374',
              lifecycleState: 'ACTIVE',
            });
      const fetcher = vi.fn<typeof fetch>(async url => {
        if (!String(url).includes('cudyrOfficialReports')) return Response.json({ documents: [] });
        if (problem === 'missing_document') return new Response('', { status: 404 });
        return Response.json({
          updateTime: problem === 'invalid_types' ? 42 : '2026-10-09T00:00:00Z',
          fields: {
            version: {
              stringValue:
                problem === 'invalid_types' ? 42 : problem === 'missing_version' ? '' : 'fixture',
            },
            month: { stringValue: '2026-09' },
          },
        });
      });
      return collectMigrationInventory({ runGcloud, fetchImpl: fetcher }).then(report => {
        expect(report.checks.officialCudyrUnchanged).toBe(false);
        expect(report.canUseForPlanning).toBe(false);
        expect(fetcher).toHaveBeenCalledTimes(8);
      });
    }
  );
  it('uses CLI code 2 for a completed inventory with unavailable CUDYR evidence', async () => {
    const args = input();
    args.officialAfter = {};
    const report = buildMigrationInventory(args);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(await runInventoryCli([], async () => report)).toBe(2);
      expect(JSON.parse(log.mock.calls[0][0]).checks.officialCudyrUnchanged).toBe(false);
    } finally {
      log.mockRestore();
    }
  });
  it('keeps network/access failures distinct from unavailable evidence', async () => {
    const read = makeInventoryReader(
      'test-token-placeholder',
      vi.fn<typeof fetch>(async () => new Response('', { status: 403 }))
    );
    await expect(
      read(
        `https://firestore.googleapis.com/v1/projects/${TARGET_PROJECT}/databases/(default)/documents/hospitals/hanga_roa/cudyrOfficialReports/2026-08`
      )
    ).rejects.toThrow('inventory_read_failed');
  });
  it('collects all pages in both projects and in both version checks', async () => {
    const runGcloud = (args: string[]) =>
      args[0] === 'auth'
        ? 'test-token-placeholder'
        : JSON.stringify({
            projectId: args[2],
            projectNumber: args[2] === SOURCE_PROJECT ? '179072085914' : '339724354374',
            lifecycleState: 'ACTIVE',
          });
    const fetcher = vi.fn<typeof fetch>(async inputUrl => {
      const url = new URL(String(inputUrl));
      if (url.pathname.includes('cudyrOfficialReports'))
        return Response.json({
          updateTime: '2026-10-09T00:00:00Z',
          fields: {
            version: { stringValue: 'fixture' },
            month: { stringValue: url.pathname.endsWith('2026-08') ? '2026-08' : '2026-09' },
          },
        });
      const project = url.pathname.includes(SOURCE_PROJECT) ? SOURCE_PROJECT : TARGET_PROJECT;
      const secondPage = url.searchParams.get('pageToken') === 'page-2';
      return Response.json({
        documents: [doc(project, secondPage ? '2026-09-20' : '2026-09-19')],
        ...(!secondPage ? { nextPageToken: 'page-2' } : {}),
      });
    });
    const report = await collectMigrationInventory({ runGcloud, fetchImpl: fetcher });
    expect(report.sourceDays).toBe(2);
    expect(report.targetDays).toBe(2);
    expect(report.canUseForPlanning).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(12);
    expect(report.days.map(day => day.date)).toEqual(['2026-09-19', '2026-09-20']);
    const later = fetcher.mock.calls
      .map(([url]) => new URL(String(url)))
      .filter(url => url.searchParams.has('pageToken'));
    expect(later).toHaveLength(4);
    expect(later.every(url => url.searchParams.get('pageToken') === 'page-2')).toBe(true);
    expect(
      later.filter(url => url.searchParams.getAll('mask.fieldPaths').length === 1)
    ).toHaveLength(2);
  });
});
