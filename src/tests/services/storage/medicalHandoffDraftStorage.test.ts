/**
 * Synthetic-only: two tabs are two independent instances of the real draft module sharing one
 * localStorage. Adapted from the cross-tab draft loss reproduction for PR #1026. The test setup
 * stubs localStorage with a plain object, so failures are injected on that object; a spy on
 * Storage.prototype would never fire here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type DraftModule = typeof import('@/services/storage/medicalHandoffDraftStorage');
const owner = 'user:synthetic-tabs';
const draft = (entryId: string, value: string, date = '2026-10-24') => ({
  date,
  patientName: 'PACIENTE SINTETICO',
  documentType: 'Pasaporte',
  rut: 'SYNTHETIC-ID',
  clinicalEpisodeId: 'synthetic-episode',
  entryId,
  value,
});
const openTab = async (): Promise<DraftModule> => {
  vi.resetModules();
  return import('@/services/storage/medicalHandoffDraftStorage');
};
const write = (
  tab: DraftModule,
  value: ReturnType<typeof draft>,
  writer = tab.createMedicalHandoffDraftWriter()
) => tab.writeMedicalHandoffDraft(writer, value);
/** The setup's storage object is plain, so a failure is injected by swapping its method. */
const realSetItem = localStorage.setItem;
const injectSetItem = (implementation: (key: string, value: string) => void) => {
  localStorage.setItem = implementation;
};
const quotaExceeded = () => {
  throw new DOMException('Synthetic storage limit', 'QuotaExceededError');
};
/** A tab opened afterwards sees only what reached storage, as after a reload. */
const storedValues = async () =>
  (await openTab())
    .readMedicalHandoffDrafts()
    .map(item => item.value)
    .sort();

beforeEach(() => {
  localStorage.setItem = realSetItem;
  localStorage.clear();
  localStorage.setItem('hhr_session_owner_v1', owner);
});
afterEach(() => {
  localStorage.setItem = realSetItem;
});

describe('drafts across tabs', () => {
  it('keeps one draft per clinical date instead of replacing the previous day', async () => {
    const tab = await openTab();
    write(tab, draft('primary-note', 'PENDIENTE D1'));
    write(tab, draft('primary-note', 'PENDIENTE D2', '2026-10-25'));
    expect(
      (await openTab()).readMedicalHandoffDrafts().map(item => [item.date, item.value])
    ).toEqual(
      expect.arrayContaining([
        ['2026-10-24', 'PENDIENTE D1'],
        ['2026-10-25', 'PENDIENTE D2'],
      ])
    );
  });

  it('keeps another tab draft when a draft held in memory after a full storage becomes durable', async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    const writerA = tabA.createMedicalHandoffDraftWriter();
    injectSetItem(quotaExceeded);
    expect(write(tabA, draft('entry-A', 'BORRADOR EN MEMORIA'), writerA)).toBe(false);
    injectSetItem(realSetItem);
    expect(tabA.readMedicalHandoffDrafts()).toContainEqual(
      expect.objectContaining({ value: 'BORRADOR EN MEMORIA', durable: false })
    );
    expect(write(tabB, draft('entry-B', 'BORRADOR DURABLE B'))).toBe(true);
    expect(write(tabA, draft('entry-A', 'BORRADOR RECUPERADO A'), writerA)).toBe(true);
    expect(await storedValues()).toEqual(['BORRADOR DURABLE B', 'BORRADOR RECUPERADO A']);
  });

  it('keeps both drafts when tab B writes between tab A read and write', async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    tabA.readMedicalHandoffDrafts();
    let interleave = true;
    injectSetItem((key, value) => {
      if (interleave && key.startsWith('hhr.medicalHandoffDraft')) {
        interleave = false;
        expect(write(tabB, draft('entry-B', 'BORRADOR B'))).toBe(true);
      }
      realSetItem(key, value);
    });
    expect(write(tabA, draft('entry-A', 'BORRADOR A'))).toBe(true);
    expect(interleave).toBe(false);
    injectSetItem(realSetItem);
    expect(await storedValues()).toEqual(['BORRADOR A', 'BORRADOR B']);
  });

  it('never deletes another tab newer text when confirming or discarding an older copy', async () => {
    const tabA = await openTab();
    const tabB = await openTab();
    write(tabA, draft('entry-1', 'Texto de A'));
    write(tabB, draft('entry-1', 'Texto de B, más nuevo'));
    tabA.confirmMedicalHandoffDrafts('2026-10-24', [
      { ...draft('entry-1', ''), entries: [{ id: 'entry-1', note: 'Texto de A' }] },
    ]);
    expect(await storedValues()).toEqual(['Texto de B, más nuevo']);
    const stale = { ...(await openTab()).readMedicalHandoffDrafts()[0], value: 'Texto viejo' };
    expect(tabA.discardMedicalHandoffDraft(stale)).toBe(false);
    expect(await storedValues()).toEqual(['Texto de B, más nuevo']);
  });

  it('leaves a list saved in the earlier preview format untouched and unread', async () => {
    const earlier = JSON.stringify([draft('entry-1', 'Nota de una vista previa')]);
    localStorage.setItem(`hhr.medicalHandoffDrafts.v1:${owner}`, earlier);
    expect((await openTab()).readMedicalHandoffDrafts()).toEqual([]);
    expect(localStorage.getItem(`hhr.medicalHandoffDrafts.v1:${owner}`)).toBe(earlier);
  });
});
