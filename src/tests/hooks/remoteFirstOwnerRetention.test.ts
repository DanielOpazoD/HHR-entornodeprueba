import { writeMedicalHandoffDraft, readMedicalHandoffDrafts, resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';
import {
  saveDetailed,
  updatePartialDetailed,
} from '@/services/repositories/dailyRecordRepositoryWriteService';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import {
  setSessionGeneration,
  SESSION_GENERATION_KEY,
} from '@/services/storage/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import {
  resolvePatchErrorFeedback,
  resolvePatchOutcomeFeedback,
  resolveSaveOutcomeFeedback,
} from '@/hooks/controllers/dailyRecordSyncNotificationController';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PartialUpdateDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
vi.unmock('@/application/ports/dailyRecordPort');
const remote = vi.hoisted(() => ({
  record: null as DailyRecord | null,
  specialist: false,
  write: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  getRecordFromFirestore: async () => remote.record,
}));
vi.mock('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting', async original => ({
  ...(await original<
    typeof import('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting')
  >()),
  shouldRouteSpecialistPatchViaCallable: async () => remote.specialist,
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreRecordWrites')>()),
  updateRecordPartial: remote.write,
  saveRecordToFirestore: remote.write,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: () => true,
  getFirestoreSyncState: () => ({ mode: 'enabled' }),
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
const frame = document.createElement('iframe');
document.body.append(frame);
const local = frame.contentWindow!.localStorage,
  session = frame.contentWindow!.sessionStorage;
afterAll(() => frame.remove());
const date = '2026-11-12';
let base: DailyRecord & { meta?: { revision: number } };
beforeEach(async () => {
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  resetMedicalHandoffDraftMemoryForTests();
  vi.mocked(recordOperationalTelemetry).mockClear();
  local.clear();
  session.clear();
  setSessionGeneration('synthetic-A');
  local.setItem(SESSION_OWNER_KEY, 'user:synthetic-A');
  local.setItem(SESSION_GENERATION_KEY, 'synthetic-A');
  await hospitalDB.open();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
  base = DataFactory.createMockDailyRecord(date);
  base.beds = {
    R1: {
      ...base.beds.R1,
      patientName: 'SYNTHETIC PATIENT',
      clinicalEpisodeId: 'synthetic-episode',
      specialty: 'Medicina',
    },
  };
  base.meta = { revision: 1 };
  await hospitalDB.dailyRecords.put(base);
  remote.record = base;
  remote.write.mockReset();
  remote.write.mockImplementation(async () => ({
    recordState: { record: base, lastUpdated: base.lastUpdated, meta: base.meta },
  }));
});
afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});
it.each(
  ['specialist', 'specialty', 'clear', 'structural', 'crib'].flatMap(kind =>
    [false, true].map(change => ({ kind, change }))
  )
)('keeps ownership for $kind (session changes: $change)', async ({ kind, change }) => {
  remote.specialist = kind === 'specialist';
  let unlock!: () => void;
  const gate = new Promise<void>(r => (unlock = r));
  const lock = runExclusiveDailyRecordWrite(date, () => gate);
  const options: PartialUpdateDailyRecordOptions = {
    baseRecord: base,
    requireRemoteAuthorityFirst: true,
    requireConfirmedRecord: true,
  };
  let patch: DailyRecordPatch = { 'beds.R1.medicalHandoffNote': 'SYNTHETIC A NOTE' };
  if (kind === 'specialty') {
    patch = { 'beds.R1.specialty': 'Cirugía' };
    options.requireAtomicCas = true;
    options.specialtyIntent = {
      kind: 'manual',
      bedId: 'R1',
      target: 'bed',
      episodeId: 'synthetic-episode',
      value: 'Cirugía',
      expectedDecisionId: null,
    };
  }
  if (kind === 'clear') {
    patch = { 'beds.R1.patientName': '' };
    options.intentionalBedClear = {
      bedId: 'R1',
      target: 'bed',
      confirmedLastUpdated: base.lastUpdated,
      confirmedOccupant: {
        patientName: base.beds.R1.patientName,
        clinicalEpisodeId: 'synthetic-episode',
      },
    };
  }
  if(kind==='crib') {
    patch={'beds.R1.clinicalCrib': {...base.beds.R1,bedId:'R1-C',patientName:'SYNTHETIC NEWBORN',clinicalEpisodeId:'synthetic-newborn'}};
    options.clinicalCribCreate={bedId:'R1',confirmedLastUpdated:base.lastUpdated,confirmedParent:{clinicalEpisodeId:'synthetic-episode',patientName:base.beds.R1.patientName}};
  }
  if(kind==='specialist') writeMedicalHandoffDraft('synthetic-writer',{date,documentType:'RUT',rut:base.beds.R1.rut,patientName:base.beds.R1.patientName,clinicalEpisodeId:'synthetic-episode',entryId:'primary-note',value:'SYNTHETIC A NOTE'});
  const nextRow={...base,notes:'SYNTHETIC B ROW'};
  const nextTask={id:800,opId:'synthetic-b-pending',type:'UPDATE_DAILY_RECORD' as const,payload:nextRow,timestamp:1,retryCount:0,status:'PENDING' as const,ownerKey:'user:synthetic-B',key:`daily:${date}`};
  const write =
    kind === 'structural'
      ? saveDetailed(base, base.lastUpdated, { baseRecord: base, rayenStructuralWriteGuard: true })
      : updatePartialDetailed(date, patch, options);
  const settled = write.catch(error => ({ error }));
  try {
    if (change) {
      await clearSessionScopedClientState('manual');
      await reconcileAuthorizedSessionOwner('user:synthetic-B');
      await hospitalDB.dailyRecords.put(nextRow);
      await hospitalDB.syncQueue.put(nextTask);
    }
  } finally {
    unlock();
    await lock;
  }
  const result = await settled;
  if (!change) {
    expect(remote.write).toHaveBeenCalledTimes(1);
    expect(remote.write.mock.calls[0][0]).toEqual(
      kind === 'structural' ? expect.objectContaining({ date }) : date
    );
    return;
  }
  expect(remote.write).not.toHaveBeenCalled();
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(nextRow);
  expect(await hospitalDB.syncQueue.get(800)).toEqual(nextTask);
  expect(result).toMatchObject({outcome:'unrecoverable',savedLocally:false});
  expect(vi.mocked(recordOperationalTelemetry)).toHaveBeenCalledWith(expect.objectContaining({operation:'remote_first_write_session_changed'}));
  if ('updatedRemotely' in result) expect(resolvePatchOutcomeFeedback(result)).toBeNull();
  if ('savedRemotely' in result) expect(resolveSaveOutcomeFeedback(result)).toBeNull();
  const tasks = (await hospitalDB.syncQueue.toArray()).filter(task=>task.ownerKey==='user:synthetic-A');
  if (kind === 'specialist') {
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      type: 'UPDATE_SPECIALIST_HANDOFF',
      ownerKey: 'user:synthetic-A',
    });
    expect(JSON.stringify(tasks[0])).toContain('SYNTHETIC A NOTE');
    expect(JSON.stringify(tasks[0])).toContain('synthetic-episode');
    expect(readMedicalHandoffDrafts()).toEqual([]);
    local.setItem(SESSION_OWNER_KEY,'user:synthetic-A');
    expect(readMedicalHandoffDrafts().some(draft=>draft.value==='SYNTHETIC A NOTE')).toBe(true);
  } else expect(tasks).toHaveLength(0);
});

it('preserves the same-session rejection and its existing feedback', async()=>{
  remote.specialist=false;
  const error=new ConcurrencyError('SYNTHETIC SERVER REJECTION','semantic_conflict');
  remote.write.mockRejectedValue(error);
  await expect(updatePartialDetailed(date,{'beds.R1.specialty':'Cirugía'},{baseRecord:base,requireAtomicCas:true,requireRemoteAuthorityFirst:true})).rejects.toBe(error);
  expect(resolvePatchErrorFeedback(error)).toMatchObject({title:'Conflicto de Edición',message:error.message});
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(base);
});
it('does not retry a CAS rejection after the author leaves',async()=>{
 remote.specialist=false;
 remote.write.mockImplementationOnce(async()=>{
  await clearSessionScopedClientState('manual');await reconcileAuthorizedSessionOwner('user:synthetic-B');await hospitalDB.dailyRecords.put(base);
  throw new ConcurrencyError('SYNTHETIC VERSION CONFLICT','version_mismatch');
 });
 const result=await updatePartialDetailed(date,{'beds.R1.specialty':'Cirugía'},{baseRecord:base,specialtyIntent:{kind:'manual',bedId:'R1',target:'bed',episodeId:'synthetic-episode',value:'Cirugía',expectedDecisionId:null}});
 expect(remote.write).toHaveBeenCalledTimes(1);
 expect(resolvePatchOutcomeFeedback(result)).toBeNull();
 expect(await hospitalDB.dailyRecords.get(date)).toEqual(base);
});
