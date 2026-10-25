import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRecord, buildPatient } from './dailyRecordHandoffPatchTestSupport';
import { shouldRouteSpecialistPatchViaCallable } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { buildSpecialistHandoffTargets } from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
describe('specialist handoff offline durability', () => {
  beforeEach(() => vi.clearAllMocks());
  it('rejects an identity captured while typing if another patient occupies the local row before persistence', async () => {
    vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(true);
    const edited = buildRecord('2026-10-24');
    edited.beds.R1 = { ...buildPatient('R1', 'Paciente A Sintético'), clinicalEpisodeId: 'ep-A' };
    const patch = { 'beds.R1.medicalHandoffNote': 'Nota para A' };
    const current = {
      ...edited,
      beds: {
        R1: { ...edited.beds.R1, clinicalEpisodeId: 'ep-B', patientName: 'Paciente B Sintético' },
      },
    };
    await expect(
      updatePartialDetailed(current.date, patch, {
        baseRecord: current,
        specialistHandoffTargets: buildSpecialistHandoffTargets(edited, patch),
      })
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(queueDailyRecordSyncTaskWithLocalRecord).not.toHaveBeenCalled();
    expect(updateRecordPartialToFirestore).not.toHaveBeenCalled();
  });

  it('derives a legacy episode when the original local patient has no stored id', async () => {
    vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(true);
    const current = buildRecord('2026-10-24');
    current.beds.R1 = buildPatient('R1', 'Paciente Heredado Sintético');
    vi.mocked(updateRecordPartialToFirestore).mockResolvedValueOnce(undefined);
    await updatePartialDetailed(
      current.date,
      { 'beds.R1.medicalHandoffNote': 'Nota heredada' },
      { baseRecord: current }
    );
    expect(updateRecordPartialToFirestore).toHaveBeenCalledWith(
      current.date,
      expect.anything(),
      current.lastUpdated,
      expect.objectContaining({
        specialistHandoffTargets: [
          expect.objectContaining({ clinicalEpisodeId: expect.stringMatching(/^legacy_ep_.+/) }),
        ],
      })
    );
  });

  it('saves an offline specialist note locally with its expected occupant in the replay contract', async () => {
    vi.mocked(shouldRouteSpecialistPatchViaCallable).mockResolvedValue(true);
    const current = buildRecord('2026-10-24');
    current.beds = {
      R1: { ...buildPatient('R1', 'Paciente A Sintético'), clinicalEpisodeId: 'ep-A' },
    };
    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce({
      code: 'functions/unavailable',
    });
    const result = await updatePartialDetailed(
      current.date,
      { 'beds.R1.medicalHandoffNote': 'Nota offline para A' },
      { baseRecord: current }
    );
    expect(result).toMatchObject({
      savedLocally: true,
      updatedRemotely: false,
      queuedForRetry: true,
    });
    expect(queueDailyRecordSyncTaskWithLocalRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        beds: expect.objectContaining({
          R1: expect.objectContaining({ medicalHandoffNote: 'Nota offline para A' }),
        }),
      }),
      expect.objectContaining({
        syncContract: expect.objectContaining({
          specialistHandoffTargets: [
            expect.objectContaining({
              clinicalEpisodeId: 'ep-A',
              patientName: 'Paciente A Sintético',
            }),
          ],
        }),
      }),
      expect.anything()
    );
  });
});
