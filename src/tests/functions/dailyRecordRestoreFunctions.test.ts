import { describe, expect, it } from 'vitest';
import {
  harness,
  record,
  episode,
  Timestamp,
  DATE,
  NOW,
  DAY,
  CONTEXT,
  createDailyRecordWriteAuthorityFunctions,
} from './dailyRecordRestore.test-support';

describe('daily record administrative restore', () => {
  it.each(['viewer', 'editor', 'nurse_hospital', 'doctor'])(
    'rejects %s before clinical reads',
    async role => {
      const h = harness(role);
      for (const callable of [h.api.previewDailyRecordRestore, h.api.restoreDailyRecord])
        await expect(callable.run(h.request, CONTEXT)).rejects.toMatchObject({
          code: 'permission-denied',
        });
      expect(h.reads()).toBe(0);
      expect(h.log).toHaveLength(0);
    }
  );
  it('rejects unauthenticated callers', async () => {
    const h = harness();
    await expect(h.api.restoreDailyRecord.run(h.request, {})).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
  it.each([
    { date: '2026-02-30' },
    { date: '../day' },
    { readTime: 'invalid' },
    { readTime: '2026-02-30T14:00:00Z' },
    { readTime: '2026-11-01T14:00:01Z' },
    { readTime: '2026-11-02T00:00:00Z' },
    { readTime: '2026-10-20T00:00:00Z' },
    { backupId: '../copy' },
  ])('rejects invalid source %j without writes', async invalid => {
    const h = harness();
    await expect(
      h.api.previewDailyRecordRestore.run({ ...h.source, ...invalid }, CONTEXT)
    ).rejects.toThrow();
    expect(h.reads()).toBe(0);
    expect(h.log).toHaveLength(0);
  });
  it('compares recognizable identities, movements, documents and clinical warnings without full data', async () => {
    const h = harness();
    const result = await h.api.previewDailyRecordRestore.run(h.source, CONTEXT);
    expect(result.current).toMatchObject({
      revision: 10,
      lastUpdated: record().lastUpdated,
      occupiedBeds: [{ rut: 'PAS-123', documentType: 'Pasaporte', clinicalEpisodeId: 'episode-1' }],
      clinicalCribs: [{ clinicalEpisodeId: 'episode-rn' }],
      discharges: [{ patientName: 'Alta sintética' }],
      episodeDocuments: [{ clinicalEpisodeId: 'episode-1', currentGeneration: true }],
    });
    expect(result.current.warnings).toHaveLength(3);
    expect(result.current.beds).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('vitalSignsHistory');
    expect(h.log).toHaveLength(0);
  });
  it('propagates failed historical and current reads as failure, never an empty day', async () => {
    const h = harness();
    h.failRead();
    await expect(h.api.previewDailyRecordRestore.run(h.source, CONTEXT)).rejects.toMatchObject({
      code: 'unavailable',
    });
    const missing = harness();
    missing.docs.delete(DAY);
    await expect(
      missing.api.previewDailyRecordRestore.run(missing.source, CONTEXT)
    ).rejects.toMatchObject({ code: 'not-found' });
  });
  it.each([
    { confirmationDate: '2026-10-31' },
    { expectedLastUpdated: '2026-11-01T15:31:00.000Z' },
    { expectedLastUpdated: null },
  ])('rejects confirmation/version %j atomically', async invalid => {
    const h = harness();
    await expect(
      h.api.restoreDailyRecord.run({ ...h.request, ...invalid }, CONTEXT)
    ).rejects.toThrow();
    expect(h.docs.get(DAY)).toEqual(record());
    expect(h.log).toHaveLength(0);
  });
  it('detects a concurrent edit on transaction retry without committing backup or overwrite', async () => {
    const h = harness();
    h.concurrent(() => h.docs.set(DAY, { ...record(), lastUpdated: '2026-11-01T15:59:00.000Z' }));
    await expect(h.api.restoreDailyRecord.run(h.request, CONTEXT)).rejects.toMatchObject({
      code: 'aborted',
    });
    expect(h.log).toHaveLength(0);
  });
  it('backs up complete state first, restores a new revision and atomically audits the administrator', async () => {
    const h = harness();
    h.docs.set(`${DAY}/clinicalDerived/later`, episode('later'));
    const result = await h.api.restoreDailyRecord.run(h.request, CONTEXT);
    expect(result).toMatchObject({ success: true, revision: 11 });
    const backup = h.docs.get(`${DAY}/conflictSnapshots/${result.backupId}`);
    expect(backup?.record).toEqual(record());
    expect(backup?.episodeBackupIds).toHaveLength(2);
    expect(backup?.expireAt).toEqual(Timestamp.fromMillis(NOW + 48 * 3600000));
    expect(h.log[0].path).toContain('/conflictSnapshots/');
    const restored = h.docs.get(DAY);
    expect(restored?.meta).toMatchObject({ revision: 11, lastChangedPaths: ['*'] });
    expect(restored?.lastUpdated).toEqual(Timestamp.fromMillis(NOW));
    const doc = h.docs.get(`${DAY}/clinicalDerived/episode-1`);
    expect(doc).toMatchObject({ dayRevision: 11, vitalSignsHistory: [{ pulse: 65 }] });
    expect(doc?.layoutGeneration).not.toBe('original');
    expect(h.docs.get(`${DAY}/clinicalDerived/later`)).toEqual(episode('later'));
    expect(h.log.find(write => write.path.includes('/auditLogs/'))?.data).toMatchObject({
      action: 'CONFLICT_VERSION_RESTORED',
      userId: 'admin@example.com',
      userUid: 'synthetic-admin',
      details: { event: 'daily_record_restored', source: h.source, backupId: result.backupId },
    });
  });
  it.each(['/conflictSnapshots/', '/auditLogs/', '/clinicalDerived/'])(
    'a commit failure at %s leaves the day unchanged',
    async path => {
      const h = harness();
      h.failCommit(path);
      await expect(h.api.restoreDailyRecord.run(h.request, CONTEXT)).rejects.toMatchObject({
        code: 'unavailable',
      });
      expect(h.docs.get(DAY)).toEqual(record());
      expect(h.log).toHaveLength(0);
    }
  );
  it('undoes from the exact pre-restore copy, with another backup and increasing revision', async () => {
    const h = harness();
    const first = await h.api.restoreDailyRecord.run(h.request, CONTEXT);
    const source = { date: DATE, backupId: first.backupId };
    const preview = await h.api.previewDailyRecordRestore.run(source, CONTEXT);
    expect(preview.selected.revision).toBe(10);
    const undo = await h.api.restoreDailyRecord.run(
      { ...source, expectedLastUpdated: first.lastUpdated, confirmationDate: DATE },
      CONTEXT
    );
    expect(undo.revision).toBe(12);
    expect(h.docs.get(`${DAY}/clinicalDerived/episode-1`)).toMatchObject({
      vitalSignsHistory: [{ pulse: 80 }],
      dayRevision: 12,
    });
    expect(h.docs.has(`${DAY}/conflictSnapshots/${undo.backupId}`)).toBe(true);
  });
  it('refuses an expired or incomplete undo backup', async () => {
    const h = harness();
    const first = await h.api.restoreDailyRecord.run(h.request, CONTEXT);
    const root = h.docs.get(`${DAY}/conflictSnapshots/${first.backupId}`);
    h.docs.delete(`${DAY}/conflictSnapshots/${first.backupId}_ep_0`);
    await expect(
      h.api.previewDailyRecordRestore.run({ date: DATE, backupId: first.backupId }, CONTEXT)
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    h.docs.set(`${DAY}/conflictSnapshots/${first.backupId}`, {
      ...root,
      expireAt: Timestamp.fromMillis(NOW - 1),
    });
    await expect(
      h.api.previewDailyRecordRestore.run({ date: DATE, backupId: first.backupId }, CONTEXT)
    ).rejects.toMatchObject({ code: 'not-found' });
  });
  it('rejects large 300KB episode sets rather than splitting the replacement into batches', async () => {
    const h = harness();
    for (let i = 0; i < 20; i++)
      h.docs.set(`${DAY}/clinicalDerived/big-${i}`, {
        ...episode(`big-${i}`),
        padding: 'x'.repeat(300000),
      });
    await expect(h.api.restoreDailyRecord.run(h.request, CONTEXT)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(h.log).toHaveLength(0);
    expect(h.docs.get(DAY)).toEqual(record());
  });
  it('restoring an embedded day leaves later episode documents invisible without deleting them', async () => {
    const h = harness();
    Reflect.deleteProperty(h.historical.record, 'clinicalDerivedLayout');
    h.historical.docs = [];
    await h.api.restoreDailyRecord.run(h.request, CONTEXT);
    expect(h.docs.get(DAY)?.clinicalDerivedLayout).toBeUndefined();
    expect(h.docs.get(`${DAY}/clinicalDerived/episode-1`)).toEqual(episode());
  });
  it('rejects a pending full save from another team against the restored version', async () => {
    const h = harness();
    await h.api.restoreDailyRecord.run(h.request, CONTEXT);
    h.log.length = 0;
    const authority = createDailyRecordWriteAuthorityFunctions({
      firestore: h.firestore,
      Timestamp,
      resolveRoleForEmail: async () => 'admin',
    });
    await expect(
      authority.saveDailyRecordWithClinicalAuthority.run(
        {
          date: DATE,
          record: record(),
          expectedLastUpdated: record().lastUpdated,
          mode: 'enforced',
          origin: 'direct_save',
          syncContract: { mutationId: 'pending-other-team', baseRevision: 10, changedPaths: ['*'] },
        },
        CONTEXT
      )
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(h.log.filter(write => write.path === DAY)).toHaveLength(0);
    expect(h.docs.get(DAY)?.meta).toMatchObject({ revision: 11 });
  });
  it('rejects incoherent episode documents and unsupported layouts without writing', async () => {
    const h = harness();
    h.historical.docs[0].data.dayRevision = 50;
    await expect(h.api.restoreDailyRecord.run(h.request, CONTEXT)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(h.log).toHaveLength(0);
    h.historical.docs[0].data.dayRevision = 3;
    h.historical.record.clinicalDerivedLayout.version = 2;
    await expect(h.api.previewDailyRecordRestore.run(h.source, CONTEXT)).rejects.toMatchObject({
      code: 'failed-precondition',
    });
  });
  it('can repair a current day whose episode revision is inconsistent, keeping the complete prior copy', async () => {
    const h = harness();
    h.docs.set(`${DAY}/clinicalDerived/episode-1`, { ...episode(), dayRevision: 500 });
    const result = await h.api.restoreDailyRecord.run(h.request, CONTEXT);
    expect(result.success).toBe(true);
    expect(h.docs.get(`${DAY}/clinicalDerived/episode-1`)?.dayRevision).toBe(11);
    expect(h.docs.get(`${DAY}/conflictSnapshots/${result.backupId}_ep_0`)?.document).toMatchObject({
      dayRevision: 500,
    });
  });
  it('refuses excessive write counts before any commit', async () => {
    const h = harness();
    for (let i = 0; i < 201; i++)
      h.docs.set(`${DAY}/clinicalDerived/small-${i}`, episode(`small-${i}`));
    await expect(h.api.restoreDailyRecord.run(h.request, CONTEXT)).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    expect(h.log).toHaveLength(0);
  });
});
