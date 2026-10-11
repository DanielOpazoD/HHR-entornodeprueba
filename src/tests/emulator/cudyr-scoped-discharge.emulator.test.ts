import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const requireFunctions = createRequire(new URL('../../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireFunctions(
  'firebase-admin/app'
) as typeof import('firebase-admin/app');
const { getFirestore } = requireFunctions(
  'firebase-admin/firestore'
) as typeof import('firebase-admin/firestore');
const { createCudyrHistoryFunctions } = require('../../../functions/lib/cudyrHistoryFunctions.js');
const {
  fingerprint,
  sourceVersion,
} = require('../../../functions/lib/cudyrOfficialReportStore.js');
const { dischargeKey } = require('../../../functions/lib/cudyrDischargeContract.js');
const describeEmulator =
  process.env.RUN_FIRESTORE_EMULATOR_TESTS === '1' ? describe : describe.skip;

describeEmulator('episode-scoped official CUDYR revisions', () => {
  let app: App;
  let db: Firestore;
  const hospital = 'hospitals/hanga_roa';
  const context = {
    auth: {
      uid: 'synthetic-reviewer',
      token: { email: 'synthetic@example.com', name: 'Revisor sintético' },
    },
  };
  beforeAll(() => {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ''))
      throw new Error('Local emulator required.');
    app = initializeApp({ projectId: 'demo-hhr-cudyr-scoped' }, 'cudyr-scoped');
    db = getFirestore(app);
  });
  afterAll(async () => {
    if (db) await db.terminate();
    if (app) await deleteApp(app);
  });

  it('preserves unrelated official months, invalidates both months of a shared episode and blocks stale publication', async () => {
    const fns = createCudyrHistoryFunctions({
      firestore: db,
      resolveRoleForEmail: async () => 'nurse_hospital',
      hasCallableClinicalAccess: async () => true,
    });
    // Legacy metadata is retained: the new reader must not reopen existing months on upgrade.
    const legacy = db.doc(hospital + '/cudyrArchiveVersions/dischargeCorrections');
    await legacy.set({ operation: 'synthetic-legacy-operation' });
    const legacyBefore = (await legacy.get()).updateTime;
    const publish = async (month: string, episodes: string[]) => {
      const days = new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)
      ).getUTCDate();
      const report = {
        schemaVersion: 1,
        from: month + '-01',
        to: month + '-' + days,
        rows: episodes.map((id, i) => ({
          key: 'row-' + i,
          date: month + '-02',
          clinicalEpisodeId: id,
          eligibility: 'elegible',
        })),
        observations: [],
        captures: [],
        corrections: [],
        dischargeAudit: [],
        exclusions: [],
        issues: [],
        coverage: Array.from({ length: days }, (_, i) => ({
          date: month + '-' + String(i + 1).padStart(2, '0'),
          state: 'disponible',
          reconstructionApproval: { approvedAt: '2026-10-08' },
        })),
      };
      await db
        .doc(hospital + '/cudyrVerifiedContexts/' + month)
        .set({
          revision: 1,
          verification: 'reviewed_documentary_context',
          entries: [{ synthetic: true }],
        });
      await fns.archiveCudyrHistory.run(
        {
          kind: 'save-verified-context',
          action: 'approve_census',
          schemaVersion: 1,
          policyVersion: 2,
          confirmed: true,
          month,
          expectedRevision: 1,
          operationId: 'synthetic-approval-' + month,
          reason: 'Población mensual sintética revisada para la prueba.',
          days: report.coverage.map(day => ({
            date: day.date,
            fingerprint: fingerprint(report, day.date),
          })),
        },
        context
      );
      const probe = await fns.readCudyrHistory.run(
        { kind: 'official-report', month, episodes },
        context
      );
      const request = {
        kind: 'save-official-report',
        schemaVersion: 1,
        month,
        report,
        sourceVersion: probe.sourceVersion,
      };
      const receipt = await fns.archiveCudyrHistory.run(request, context);
      return { request, receipt };
    };
    // Forty episodes exercise the second Firestore `in` batch.
    const episodes = Array.from({ length: 40 }, (_, i) => 'synthetic-episode-' + i);
    const target = episodes[39];
    const august = await publish('2026-08', episodes);
    const september = await publish('2026-09', [target]);
    const july = await publish('2026-07', ['synthetic-other-episode']);
    const hospitalRef = db.doc(hospital);
    expect(await sourceVersion(hospitalRef, '2026-08', episodes)).toBe(
      await sourceVersion(hospitalRef, '2026-08', [])
    );
    await db
      .doc(hospital + '/dailyRecords/2026-08-31')
      .set({
        beds: {
          R1: { clinicalEpisodeId: target, admissionDate: '2026-07-01', admissionTime: '10:00' },
        },
      });
    const correction = {
      kind: 'correct-discharge',
      schemaVersion: 1,
      confirmed: true,
      authorityDate: '2026-08-31',
      clinicalEpisodeId: target,
      expectedRevision: 0,
      operationId: '00000000-0000-4000-8000-000000000001',
      actualDischarge: { date: '2026-08-02', time: '10:00', timeZone: 'Pacific/Easter' },
      reason: 'Salida física cotejada con evidencia sintética.',
    };
    const first = await fns.archiveCudyrHistory.run(correction, context);
    const marker = db.doc(hospital + '/cudyrArchiveVersions/discharge-' + dischargeKey(target));
    const markerBefore = (await marker.get()).updateTime;
    expect(await fns.archiveCudyrHistory.run(correction, context)).toEqual(first);
    expect((await marker.get()).updateTime?.isEqual(markerBefore!)).toBe(true);
    expect((await legacy.get()).updateTime?.isEqual(legacyBefore!)).toBe(true);
    for (const month of ['2026-08', '2026-09']) {
      const stale = await fns.readCudyrHistory.run({ kind: 'official-report', month }, context);
      expect(stale.state).toBe('missing');
      expect(stale.report).toBeUndefined();
    }
    const unaffected = await fns.readCudyrHistory.run(
      { kind: 'official-report', month: '2026-07', knownVersion: july.receipt.version },
      context
    );
    expect(unaffected.state).toBe('unchanged');
    expect(unaffected.report).toBeUndefined();
    // Even an unrelated correction during reconstruction rejects an old publication token.
    await expect(fns.archiveCudyrHistory.run(july.request, context)).rejects.toMatchObject({
      code: 'aborted',
    });
    await expect(fns.archiveCudyrHistory.run(august.request, context)).rejects.toMatchObject({
      code: 'aborted',
    });
    await expect(fns.archiveCudyrHistory.run(september.request, context)).rejects.toMatchObject({
      code: 'aborted',
    });
    // A fresh reconstruction token can publish again and subsequently use the fast read.
    const fresh = await fns.readCudyrHistory.run(
      { kind: 'official-report', month: '2026-08', episodes },
      context
    );
    const saved = await fns.archiveCudyrHistory.run(
      { ...august.request, sourceVersion: fresh.sourceVersion },
      context
    );
    expect(saved.version).not.toBe(august.receipt.version);
    expect(
      (
        await fns.readCudyrHistory.run(
          { kind: 'official-report', month: '2026-08', knownVersion: saved.version },
          context
        )
      ).state
    ).toBe('unchanged');
    // Clearing a correction is also a revision, not a return to an old official artifact.
    await fns.archiveCudyrHistory.run(
      {
        ...correction,
        expectedRevision: 1,
        operationId: '00000000-0000-4000-8000-000000000002',
        actualDischarge: null,
      },
      context
    );
    expect(
      (await fns.readCudyrHistory.run({ kind: 'official-report', month: '2026-08' }, context)).state
    ).toBe('missing');
    expect(
      (
        await fns.readCudyrHistory.run(
          { kind: 'official-report', month: '2026-07', knownVersion: july.receipt.version },
          context
        )
      ).state
    ).toBe('unchanged');
  });
});
