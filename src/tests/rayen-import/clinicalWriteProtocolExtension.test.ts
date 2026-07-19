// @vitest-environment node
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it } from 'vitest';

import '../../../extension/clinical-write-runtime.js';

type WriteGuard = {
  generationId: string;
  beginWrite: () => Promise<{ ok?: boolean; error?: string }>;
};

type Protocol = {
  withWriteLock: (
    key: string,
    task: (guard: WriteGuard) => Promise<Record<string, unknown>>
  ) => Promise<Record<string, unknown>>;
  acknowledge: (receipt: {
    key: string;
    generationId: string;
    receiptId: string;
  }) => Promise<Record<string, unknown>>;
};

type RuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => Protocol;
};

const runtimeOwner = (globalThis as typeof globalThis & { HhrClinicalWriteRuntime: RuntimeOwner })
  .HhrClinicalWriteRuntime;
const TEST_NOW_MS = Date.UTC(2026, 6, 15, 12, 0, 0);

type StorageHarness = {
  records: Map<string, Record<string, unknown>>;
  events: string[];
  failNextSet: boolean;
  failNextRemove: boolean;
};

const loadProtocol = () => {
  const harness: StorageHarness = {
    records: new Map(),
    events: [],
    failNextSet: false,
    failNextRemove: false,
  };
  const session = {
    get: async (key: string) => {
      harness.events.push('storage:get');
      const value = harness.records.get(key);
      return value ? { [key]: { ...value } } : {};
    },
    set: async (values: Record<string, Record<string, unknown>>) => {
      harness.events.push('storage:set');
      if (harness.failNextSet) {
        harness.failNextSet = false;
        throw new Error('set failed');
      }
      Object.entries(values).forEach(([key, value]) => harness.records.set(key, { ...value }));
    },
    remove: async (key: string) => {
      harness.events.push('storage:remove');
      if (harness.failNextRemove) {
        harness.failNextRemove = false;
        throw new Error('remove failed');
      }
      harness.records.delete(key);
    },
  };
  const chromeApi = { storage: { local: session } };
  const protocol = runtimeOwner.create({
    chrome: chromeApi,
    storage: session,
    crypto: globalThis.crypto,
    now: () => TEST_NOW_MS,
    authorizeRecovery: async () => ({ info: {} }),
    readRecoveryReview: async () => ({ review: {} }),
  });
  return { protocol, harness };
};

const markerFor = (harness: StorageHarness, key: string) => {
  const entry = [...harness.records.entries()].find(([storageKey]) =>
    storageKey.startsWith('hhr-clinical-write-guard-')
  );
  if (!entry) throw new Error('No se persistió la protección para ' + key);
  return { storageKey: entry[0], marker: entry[1] };
};

describe('extension clinical write protocol', () => {
  let protocol: Protocol;
  let harness: StorageHarness;

  beforeEach(() => {
    ({ protocol, harness } = loadProtocol());
  });

  it('persists an in-flight generation before allowing the clinical POST', async () => {
    const key = 'handoff:141437';
    const result = await protocol.withWriteLock(key, async guard => {
      const begun = await guard.beginWrite();
      expect(begun).toEqual({ ok: true });
      expect(harness.events.at(-1)).toBe('storage:set');
      harness.events.push('post');
      return { ok: true, verified: true, record: { id: 'verified' } };
    });

    expect(harness.events.indexOf('storage:set')).toBeLessThan(harness.events.indexOf('post'));
    expect(result.clinicalWriteReceipt).toEqual(
      expect.objectContaining({
        key,
        generationId: expect.stringMatching(/^[a-f0-9-]{20,}$/i),
        receiptId: expect.stringMatching(/^[a-f0-9-]{20,}$/i),
      })
    );
    const { marker } = markerFor(harness, key);
    expect(marker).toEqual(
      expect.objectContaining({
        schemaVersion: 3,
        state: 'awaiting-client-ack',
        generationId: (result.clinicalWriteReceipt as { generationId: string }).generationId,
      })
    );
  });

  it('does not call the POST when persisting the in-flight marker fails', async () => {
    harness.failNextSet = true;
    let posts = 0;
    const result = await protocol.withWriteLock('handoff:141437', async guard => {
      const begun = await guard.beginWrite();
      if (begun.error) return begun;
      posts += 1;
      return { ok: true, verified: true };
    });

    expect(posts).toBe(0);
    expect(String(result.error)).toContain('bloqueo preventivo');
    expect(harness.records.size).toBe(0);
  });

  it('rejects an overlapping write for the same clinical key', async () => {
    const key = 'handoff:141437';
    let releaseFirst!: () => void;
    let markEntered!: () => void;
    const entered = new Promise<void>(resolve => {
      markEntered = resolve;
    });
    const blocked = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const first = protocol.withWriteLock(key, async () => {
      markEntered();
      await blocked;
      return { ok: true, verified: false };
    });

    await entered;
    const overlapping = await protocol.withWriteLock(key, async () => ({ ok: true }));
    expect(overlapping.error).toContain('guardado clínico en curso');

    releaseFirst();
    await expect(first).resolves.toEqual({ ok: true, verified: false });
  });

  it('does not create a marker when preflight validation returns before beginWrite', async () => {
    const result = await protocol.withWriteLock('score:141437:CUDYR', async () => ({
      error: 'El paciente ya no está hospitalizado.',
    }));

    expect(result).toEqual({ error: 'El paciente ya no está hospitalizado.' });
    expect(harness.records.size).toBe(0);
    expect(harness.events).not.toContain('storage:set');
  });

  it('keeps an ambiguous generation indefinitely after an exception following beginWrite', async () => {
    const key = 'score:141437:BRADEN';
    let posts = 0;
    const first = await protocol.withWriteLock(key, async guard => {
      await guard.beginWrite();
      posts += 1;
      throw new Error('worker interrupted after post');
    });
    expect(first.writeMayHaveSucceeded).toBe(true);
    const { storageKey, marker } = markerFor(harness, key);
    expect(marker?.state).toBe('ambiguous');
    harness.records.set(storageKey, {
      ...marker,
      createdAt: TEST_NOW_MS - 11 * 60 * 1000,
      updatedAt: TEST_NOW_MS - 11 * 60 * 1000,
    });

    const second = await protocol.withWriteLock(key, async guard => {
      await guard.beginWrite();
      posts += 1;
      return { ok: true, verified: true };
    });
    expect(posts).toBe(1);
    expect(second.writeMayHaveSucceeded).toBe(true);
    expect(harness.records.get(storageKey)?.state).toBe('ambiguous');
  });

  it('clears only a definitively rejected write from the same generation', async () => {
    const key = 'score:141437:DOWNTON';
    const result = await protocol.withWriteLock(key, async guard => {
      await guard.beginWrite();
      return { error: 'HTTP 400', definitelyNotApplied: true };
    });

    expect(result).toEqual({ error: 'HTTP 400' });
    expect(harness.records.size).toBe(0);
  });

  it('requires an exact generation and receipt, and preserves the marker if remove fails', async () => {
    const key = 'handoff:141437';
    const result = await protocol.withWriteLock(key, async guard => {
      await guard.beginWrite();
      return { ok: true, verified: true };
    });
    const receipt = result.clinicalWriteReceipt as {
      key: string;
      generationId: string;
      receiptId: string;
    };
    const { storageKey } = markerFor(harness, key);

    const stale = await protocol.acknowledge({
      ...receipt,
      generationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    expect(stale.error).toBeTruthy();
    expect(harness.records.has(storageKey)).toBe(true);

    harness.failNextRemove = true;
    const failed = await protocol.acknowledge(receipt);
    expect(failed.error).toBeTruthy();
    expect(harness.records.has(storageKey)).toBe(true);

    await expect(protocol.acknowledge(receipt)).resolves.toEqual({ ok: true });
    expect(harness.records.has(storageKey)).toBe(false);
  });

  it('never stores the clinical payload in its duplicate-protection marker', async () => {
    const sensitiveText = 'Paciente estable con dolor 8/10';
    await protocol.withWriteLock('handoff:141437', async guard => {
      await guard.beginWrite();
      return { error: sensitiveText, writeMayHaveSucceeded: true };
    });
    const serialized = JSON.stringify([...harness.records.values()]);
    const storageKey = [...harness.records.keys()][0] || '';

    expect(serialized).not.toContain(sensitiveText);
    expect(serialized).not.toMatch(/observation|answers|patient|run|score|category/i);
    expect(serialized).toContain('ambiguous');
    expect(storageKey).toMatch(/^hhr-clinical-write-guard-[a-f0-9]{64}$/);
    expect(storageKey).not.toContain('141437');
    expect(harness.records.get(storageKey)).not.toHaveProperty('key');
  });

  it('does not verify a handoff readback unless the POST was positively acknowledged', () => {
    const source = readFileSync(
      new URL('../../../extension/clinical-handoff-runtime.js', import.meta.url),
      'utf8'
    );
    const start = source.indexOf('const performSaveRequest = async');
    const end = source.indexOf('\n\n    const handleSaveRequest =', start);
    const handoffWrite = source.slice(start, end);

    expect(handoffWrite).toContain('let postAcknowledged = false;');
    expect(handoffWrite).toContain('postAcknowledged = true;');
    expect(handoffWrite).toContain('if (!postAcknowledged) return false;');
    expect(handoffWrite).toContain(
      'const handoffEventTypeId = prescriptionPrint.handoffEncounterEventTypeId(handoffKind);'
    );
    expect(handoffWrite).toContain('encounterEventTypeId: handoffEventTypeId');
    expect(handoffWrite).not.toContain('encounterEventTypeId: 2');
    expect(handoffWrite.indexOf('postAcknowledged = true;')).toBeLessThan(
      handoffWrite.indexOf('if (!postAcknowledged) return false;')
    );
  });

  it('finishes the Eloisa encounter event after verifying a handoff readback', () => {
    const source = readFileSync(
      new URL('../../../extension/clinical-handoff-runtime.js', import.meta.url),
      'utf8'
    );
    const helperStart = source.indexOf('const readFinishRegisterEvent = async');
    const requestStart = source.indexOf('const performSaveRequest = async');
    const requestEnd = source.indexOf('\n\n    const handleSaveRequest =', requestStart);
    const helpers = source.slice(helperStart, requestStart);
    const handoffWrite = source.slice(requestStart, requestEnd);

    expect(helpers).toContain('encounterEvent/0/getFinishRegister');
    expect(helpers).toContain('/confirmedEncounterEvent');
    expect(helpers).toContain("url.searchParams.set('healthCarePractitionerRoleId'");
    expect(helpers).toContain("url.searchParams.set('facilityId'");
    expect(helpers).toContain('body: JSON.stringify(event)');
    expect(helpers).toContain("String(event.encounterId || '') !== String(encId)");
    expect(helpers).toContain("String(event.facilityId || '') !== String(info.facId)");
    expect(handoffWrite).toContain(
      'const finishRegister = await readFinishRegisterEvent(encId, info);'
    );
    expect(handoffWrite).toContain(
      'const finished = await confirmFinishRegisterEvent(encId, info, finishRegister.event);'
    );
    expect(handoffWrite).toContain('finishConfirmed: true');
    expect(handoffWrite.indexOf('verifiedRecord =')).toBeLessThan(
      handoffWrite.indexOf('const finishRegister = await readFinishRegisterEvent')
    );
  });

  it('revalidates score attribution and both history sources before beginWrite', () => {
    const source = readFileSync(
      new URL('../../../extension/clinical-score-write-runtime.js', import.meta.url),
      'utf8'
    );
    const requestStart = source.indexOf('const performScoreSaveRequest = async');
    const requestEnd = source.indexOf('\n\nconst handleScoreSaveRequest =', requestStart);
    const request = source.slice(requestStart, requestEnd);
    const baselineStart = source.indexOf('const readEvaluationBaseline = async');
    const saveStart = source.indexOf('const handleEvaluationScaleSave = async');
    const saveEnd = source.indexOf('\n\nconst performScoreSaveRequest =', saveStart);
    const scalePipeline = source.slice(baselineStart, saveEnd);

    expect(request).toContain("!/^\\d+$/.test(String(info.practitionerId || ''))");
    expect(scalePipeline).toContain('fetchScaleHistoryEvents(encId, info, 120)');
    expect(scalePipeline).toContain('fetchEvaluationForms(encId, info)');
    expect(
      scalePipeline.indexOf('readEvaluationBaseline({ encId, instrument, definition, info })')
    ).toBeLessThan(scalePipeline.indexOf('postEvaluationScale({'));
  });

  it('keeps background as an orchestrator and enforces bounded owner sizes', () => {
    const background = readFileSync(
      new URL('../../../extension/background.js', import.meta.url),
      'utf8'
    );
    const owner = readFileSync(
      new URL('../../../extension/clinical-write-runtime.js', import.meta.url),
      'utf8'
    );
    const scoreWriteOwner = readFileSync(
      new URL('../../../extension/clinical-score-write-runtime.js', import.meta.url),
      'utf8'
    );
    const backgroundLines = background.split('\n').length;
    const ownerLines = owner.split('\n').length;
    const scoreWriteOwnerLines = scoreWriteOwner.split('\n').length;

    expect(background).toContain("'clinical-write-runtime.js'");
    expect(background).toContain('self.HhrClinicalWriteRuntime.create({');
    expect(background).toContain(
      "throw new Error('No se pudo cargar el runtime de escrituras clínicas.')"
    );
    expect(background).not.toMatch(/const clinicalWriteLocks|persistClinicalWriteAmbiguity/);
    expect(background).not.toMatch(/transitionClinicalWriteAmbiguity|clearClinicalWriteAmbiguity/);
    expect(background).not.toMatch(
      /hashClinicalWriteRecoveryToken|signClinicalWriteRecoveryReview/
    );
    expect(background).not.toMatch(
      /const handleCudyrSave|const handleEvaluationScaleSave|const performScoreSaveRequest/
    );
    expect(backgroundLines).toBeLessThanOrEqual(4_250);
    expect(ownerLines).toBeLessThanOrEqual(525);
    expect(scoreWriteOwnerLines).toBeLessThanOrEqual(575);
  });
});
