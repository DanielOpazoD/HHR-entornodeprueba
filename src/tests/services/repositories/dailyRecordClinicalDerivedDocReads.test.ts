import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { isFirestoreEnabled, readDocs, readDoc, readSnapshot } = vi.hoisted(() => ({
  isFirestoreEnabled: vi.fn(() => true),
  readDocs: vi.fn(),
  readDoc: vi.fn(),
  readSnapshot: vi.fn(),
}));

vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled }));
vi.mock('@/services/storage/firestore/clinicalDerivedEpisodeReader', () => ({
  readClinicalDerivedEpisodeDocs: readDocs,
  readClinicalDerivedEpisodeDoc: readDoc,
  readClinicalDerivedDaySnapshot: readSnapshot,
}));

import {
  readClinicalDerivedDayDocs,
  readClinicalDerivedDaySnapshot,
  readClinicalDerivedEpisodeForDisplay,
} from '@/services/repositories/dailyRecordClinicalDerivedReadService';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';

const DATE = '2026-11-02';
const GENERATION = 'gen_synthetic_a';
const marked = { date: DATE, clinicalDerivedLayout: { version: 1, generation: GENERATION } };

const episodeDoc = (clinicalEpisodeId: string) =>
  ({
    schemaVersion: 1,
    date: DATE,
    clinicalEpisodeId,
    layoutGeneration: GENERATION,
    dayRevision: 3,
    vitalSignsHistory: null,
  }) as ClinicalDerivedEpisodeDoc;

describe('clinicalDerived document reads for the staff tool, backups and the vitals window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isFirestoreEnabled.mockReturnValue(true);
  });

  afterEach(() => {
    delete window.__HHR_E2E_OVERRIDE__;
  });

  it('reads every current document of a marked day from the server, active or not', async () => {
    const docs = [episodeDoc('ep_active'), episodeDoc('ep_discharged')];
    readDocs.mockResolvedValueOnce({ status: 'resolved', docs, fromCache: false });

    expect(await readClinicalDerivedDayDocs(marked)).toEqual({
      status: 'resolved',
      layoutGeneration: GENERATION,
      docs,
    });
    expect(readDocs).toHaveBeenCalledWith(DATE, GENERATION, { source: 'server' });
  });

  it('never turns a failed or impossible read into an empty list', async () => {
    readDocs.mockResolvedValueOnce({ status: 'permission_denied', code: 'permission-denied' });
    expect(await readClinicalDerivedDayDocs(marked)).toEqual({
      status: 'unavailable',
      reason: 'permission_denied',
      code: 'permission-denied',
    });
    readDocs.mockResolvedValueOnce({ status: 'failed', code: 'unavailable' });
    expect(await readClinicalDerivedDayDocs(marked)).toMatchObject({
      status: 'unavailable',
      reason: 'read_failed',
    });

    const unsupported = { date: DATE, clinicalDerivedLayout: { version: 2, generation: 'g' } };
    expect(await readClinicalDerivedDayDocs(unsupported)).toEqual({
      status: 'unavailable',
      reason: 'unsupported_layout',
    });
    isFirestoreEnabled.mockReturnValueOnce(false);
    expect(await readClinicalDerivedDayDocs(marked)).toEqual({
      status: 'unavailable',
      reason: 'read_failed',
      code: 'firestore_disabled',
    });
    expect(readDocs).toHaveBeenCalledTimes(2);
  });

  it('reads the current day with its documents, and never turns a failed one into a day', async () => {
    const day = { ...marked, meta: { revision: 4 } };
    readSnapshot.mockResolvedValueOnce({ status: 'resolved', day, docs: [episodeDoc('ep_a')] });
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'resolved',
      day,
      docs: [episodeDoc('ep_a')],
    });
    readSnapshot.mockResolvedValueOnce({ status: 'missing' });
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({ status: 'missing' });

    readSnapshot.mockResolvedValueOnce({ status: 'failed', code: 'day_changed' });
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'unavailable',
      reason: 'read_failed',
      code: 'day_changed',
    });
    readSnapshot.mockResolvedValueOnce({ status: 'permission_denied', code: 'permission-denied' });
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'unavailable',
      reason: 'permission_denied',
      code: 'permission-denied',
    });
    isFirestoreEnabled.mockReturnValueOnce(false);
    expect(await readClinicalDerivedDaySnapshot(DATE)).toEqual({
      status: 'unavailable',
      reason: 'read_failed',
      code: 'firestore_disabled',
    });
    expect(readSnapshot).toHaveBeenCalledTimes(4);
    expect(readSnapshot).toHaveBeenCalledWith(DATE);
  });

  it('does not read an unmarked day', async () => {
    expect(await readClinicalDerivedDayDocs({ date: DATE })).toEqual({ status: 'unmarked' });
    expect(await readClinicalDerivedDayDocs({ date: DATE, clinicalDerivedLayout: null })).toEqual({
      status: 'unmarked',
    });
    expect(readDocs).not.toHaveBeenCalled();
  });

  it('reads one episode for display from the SDK default source', async () => {
    const doc = episodeDoc('ep_active');
    readDoc.mockResolvedValueOnce({ status: 'resolved', doc, fromCache: true });

    expect(await readClinicalDerivedEpisodeForDisplay(DATE, GENERATION, ' ep_active ')).toEqual({
      status: 'resolved',
      doc,
      fromCache: true,
    });
    expect(readDoc).toHaveBeenCalledWith(DATE, GENERATION, 'ep_active', { source: 'default' });

    readDoc.mockResolvedValueOnce({ status: 'failed', code: 'unavailable' });
    expect(await readClinicalDerivedEpisodeForDisplay(DATE, GENERATION, 'ep_active')).toEqual({
      status: 'failed',
      code: 'unavailable',
    });
  });

  it('resolves invalid episode ids without a document and skips invalid generations, disabled Firestore or E2E reads', async () => {
    expect(await readClinicalDerivedEpisodeForDisplay(DATE, 'gen/x', 'ep_a')).toEqual({
      status: 'skipped',
    });
    expect(await readClinicalDerivedEpisodeForDisplay(DATE, GENERATION, '__ep__')).toEqual({
      status: 'resolved',
      doc: null,
      fromCache: false,
    });
    isFirestoreEnabled.mockReturnValueOnce(false);
    expect(await readClinicalDerivedEpisodeForDisplay(DATE, GENERATION, 'ep_a')).toEqual({
      status: 'skipped',
    });
    window.__HHR_E2E_OVERRIDE__ = {};
    expect(await readClinicalDerivedEpisodeForDisplay(DATE, GENERATION, 'ep_a')).toEqual({
      status: 'skipped',
    });
    expect(readDoc).not.toHaveBeenCalled();
  });
});
