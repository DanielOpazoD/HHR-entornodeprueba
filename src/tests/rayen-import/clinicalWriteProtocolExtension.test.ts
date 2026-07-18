// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { beforeEach, describe, expect, it } from 'vitest';

type WriteGuard = {
  generationId: string;
  beginWrite: () => Promise<{ ok?: boolean; error?: string }>;
};

type Protocol = {
  withClinicalWriteLock: (
    key: string,
    task: (guard: WriteGuard) => Promise<Record<string, unknown>>
  ) => Promise<Record<string, unknown>>;
  acknowledgeClinicalWrite: (receipt: {
    key: string;
    generationId: string;
    receiptId: string;
  }) => Promise<Record<string, unknown>>;
  clinicalWriteAmbiguityStorageKey: (key: string) => Promise<string>;
};

type StorageHarness = {
  records: Map<string, Record<string, unknown>>;
  events: string[];
  failNextSet: boolean;
  failNextRemove: boolean;
};

const loadProtocol = () => {
  const source = readFileSync(new URL('../../../extension/background.js', import.meta.url), 'utf8');
  const start = source.indexOf('const clinicalWriteLocks = new Set();');
  const end = source.indexOf('\n\nconst fetchHospitalizedBradenSummaries', start);
  if (start < 0 || end < 0) throw new Error('No se encontró el protocolo de escritura clínica.');

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
  const context = vm.createContext({
    chrome: { storage: { local: session } },
    crypto: globalThis.crypto,
    TextEncoder,
    Uint8Array,
    Uint32Array,
  });
  vm.runInContext(
    `'use strict';\n${source.slice(start, end)}\n` +
      `globalThis.__clinicalWriteProtocol = {` +
      `withClinicalWriteLock, acknowledgeClinicalWrite, clinicalWriteAmbiguityStorageKey };`,
    context
  );
  return {
    protocol: (context as unknown as { __clinicalWriteProtocol: Protocol }).__clinicalWriteProtocol,
    harness,
  };
};

describe('extension clinical write protocol', () => {
  let protocol: Protocol;
  let harness: StorageHarness;

  beforeEach(() => {
    ({ protocol, harness } = loadProtocol());
  });

  it('persists an in-flight generation before allowing the clinical POST', async () => {
    const key = 'handoff:141437';
    const result = await protocol.withClinicalWriteLock(key, async guard => {
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
    const marker = harness.records.get(await protocol.clinicalWriteAmbiguityStorageKey(key));
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
    const result = await protocol.withClinicalWriteLock('handoff:141437', async guard => {
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
    const first = protocol.withClinicalWriteLock(key, async () => {
      markEntered();
      await blocked;
      return { ok: true, verified: false };
    });

    await entered;
    const overlapping = await protocol.withClinicalWriteLock(key, async () => ({ ok: true }));
    expect(overlapping.error).toContain('guardado clínico en curso');

    releaseFirst();
    await expect(first).resolves.toEqual({ ok: true, verified: false });
  });

  it('does not create a marker when preflight validation returns before beginWrite', async () => {
    const result = await protocol.withClinicalWriteLock('score:141437:CUDYR', async () => ({
      error: 'El paciente ya no está hospitalizado.',
    }));

    expect(result).toEqual({ error: 'El paciente ya no está hospitalizado.' });
    expect(harness.records.size).toBe(0);
    expect(harness.events).not.toContain('storage:set');
  });

  it('keeps an ambiguous generation indefinitely after an exception following beginWrite', async () => {
    const key = 'score:141437:BRADEN';
    let posts = 0;
    const first = await protocol.withClinicalWriteLock(key, async guard => {
      await guard.beginWrite();
      posts += 1;
      throw new Error('worker interrupted after post');
    });
    expect(first.writeMayHaveSucceeded).toBe(true);
    const storageKey = await protocol.clinicalWriteAmbiguityStorageKey(key);
    const marker = harness.records.get(storageKey);
    expect(marker?.state).toBe('ambiguous');
    harness.records.set(storageKey, {
      ...marker,
      createdAt: Date.now() - 11 * 60 * 1000,
      updatedAt: Date.now() - 11 * 60 * 1000,
    });

    const second = await protocol.withClinicalWriteLock(key, async guard => {
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
    const result = await protocol.withClinicalWriteLock(key, async guard => {
      await guard.beginWrite();
      return { error: 'HTTP 400', definitelyNotApplied: true };
    });

    expect(result).toEqual({ error: 'HTTP 400' });
    expect(harness.records.has(await protocol.clinicalWriteAmbiguityStorageKey(key))).toBe(false);
  });

  it('requires an exact generation and receipt, and preserves the marker if remove fails', async () => {
    const key = 'handoff:141437';
    const result = await protocol.withClinicalWriteLock(key, async guard => {
      await guard.beginWrite();
      return { ok: true, verified: true };
    });
    const receipt = result.clinicalWriteReceipt as {
      key: string;
      generationId: string;
      receiptId: string;
    };
    const storageKey = await protocol.clinicalWriteAmbiguityStorageKey(key);

    const stale = await protocol.acknowledgeClinicalWrite({
      ...receipt,
      generationId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
    expect(stale.error).toBeTruthy();
    expect(harness.records.has(storageKey)).toBe(true);

    harness.failNextRemove = true;
    const failed = await protocol.acknowledgeClinicalWrite(receipt);
    expect(failed.error).toBeTruthy();
    expect(harness.records.has(storageKey)).toBe(true);

    await expect(protocol.acknowledgeClinicalWrite(receipt)).resolves.toEqual({ ok: true });
    expect(harness.records.has(storageKey)).toBe(false);
  });

  it('never stores the clinical payload in its duplicate-protection marker', async () => {
    const sensitiveText = 'Paciente estable con dolor 8/10';
    await protocol.withClinicalWriteLock('handoff:141437', async guard => {
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
      new URL('../../../extension/background.js', import.meta.url),
      'utf8'
    );
    const start = source.indexOf('const performHandoffSaveRequest = async');
    const end = source.indexOf('\n\nconst handleHandoffSaveRequest =', start);
    const handoffWrite = source.slice(start, end);

    expect(handoffWrite).toContain('let postAcknowledged = false;');
    expect(handoffWrite).toContain('postAcknowledged = true;');
    expect(handoffWrite).toContain('if (!postAcknowledged) return false;');
    expect(handoffWrite).toContain(
      'const handoffEventTypeId = self.HhrPrescriptionPrint.handoffEncounterEventTypeId(handoffKind);'
    );
    expect(handoffWrite).toContain('encounterEventTypeId: handoffEventTypeId');
    expect(handoffWrite).not.toContain('encounterEventTypeId: 2');
    expect(handoffWrite.indexOf('postAcknowledged = true;')).toBeLessThan(
      handoffWrite.indexOf('if (!postAcknowledged) return false;')
    );
  });

  it('finishes the Eloisa encounter event after verifying a handoff readback', () => {
    const source = readFileSync(
      new URL('../../../extension/background.js', import.meta.url),
      'utf8'
    );
    const helperStart = source.indexOf('const readFinishRegisterEvent = async');
    const requestStart = source.indexOf('const performHandoffSaveRequest = async');
    const requestEnd = source.indexOf('\n\nconst handleHandoffSaveRequest =', requestStart);
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
      new URL('../../../extension/background.js', import.meta.url),
      'utf8'
    );
    const requestStart = source.indexOf('const performScoreSaveRequest = async');
    const requestEnd = source.indexOf('\n\nconst handleScoreSaveRequest =', requestStart);
    const request = source.slice(requestStart, requestEnd);
    const saveStart = source.indexOf('const handleEvaluationScaleSave = async');
    const saveEnd = source.indexOf('\n\nconst performScoreSaveRequest =', saveStart);
    const scaleSave = source.slice(saveStart, saveEnd);

    expect(request).toContain("!/^\\d+$/.test(String(info.practitionerId || ''))");
    expect(scaleSave).toContain('fetchScaleHistoryEvents(encId, info, 120)');
    expect(scaleSave).toContain('fetchEvaluationForms(encId, info)');
    expect(scaleSave.indexOf('fetchScaleHistoryEvents(encId, info, 120)')).toBeLessThan(
      scaleSave.indexOf('const begun = await writeGuard.beginWrite()')
    );
  });
});
