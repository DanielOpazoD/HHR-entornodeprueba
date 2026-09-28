import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { EMPTY_PATIENT } from '@/constants/patient';
import type { QueryClient } from '@tanstack/react-query';
import {
  buildConfirmedBedOccupantIdentity,
  buildConfirmedAssociatedCribIdentity,
  canRebaseIntentionalBedClear,
} from '@/hooks/controllers/intentionalBedClearController';
import { markDailyRecordRemoteConfirmed } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { setRemoteConfirmedDailyRecordQueryData } from '@/hooks/controllers/dailyRecordConfirmedCacheController';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';
import type { ConfirmedRayenCensusApplyResult } from './useRayenCensusDiffApplication';
import { assertRayenCensusPersistenceConfirmed } from './rayenCensusPersistenceGuard';
import { matchesDischargeSubject } from '../domain/dischargeSubjectIdentity';
import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { DischargeEntry } from '../contracts/censusImportDiff';

const conflict = () => {
  const error = new Error(
    'La cama o la sincronización cambió antes de confirmar el egreso histórico.'
  );
  error.name = 'ConcurrencyError';
  return error;
};

const hasConfirmedMovement = (record: DailyRecord, entry: DischargeEntry): boolean =>
  (entry.kind === 'alta'
    ? record.discharges
    : entry.kind === 'traslado'
      ? record.transfers
      : record.cma
  ).some(
    movement =>
      !movement.deletedAt &&
      matchesDischargeSubject(
        {
          ...movement.originalData,
          clinicalEpisodeId: movement.clinicalEpisodeId ?? movement.originalData?.clinicalEpisodeId,
          rut: movement.rut,
          patientName: movement.patientName,
        } as PatientData,
        entry
      )
  );

/** Finish only reviewed historical removals whose movement is now authoritative on its real day. */
export const finalizeRayenHistoricalDischarges = async (
  result: ConfirmedRayenCensusApplyResult,
  repository: Pick<DailyRecordRepositoryPort, 'getAuthoritativeForDate' | 'updatePartialDetailed'>,
  queryClient: QueryClient,
  clearHistoricalOccupants = false
): Promise<ConfirmedRayenCensusApplyResult> => {
  const entries = result.deferredHistoricalDischarges ?? [];
  if (!entries.length) return result;
  return runExclusiveDailyRecordWrite(result.record.date, async dailyRecordWriteLease => {
    let confirmed = result.record;
    for (const entry of entries) {
      const historical = await repository.getAuthoritativeForDate(entry.correctedDay!);
      const original = result.record.beds[entry.bedId];
      if (!historical || !hasConfirmedMovement(historical, entry)) {
        throw new Error(
          'El egreso histórico aún no está confirmado; la cama se conserva para reintentar.'
        );
      }
      if (!original || !matchesDischargeSubject(original, entry)) throw conflict();
      // Clearing a parent also removes its crib. Require separately recorded evidence for that
      // exact newborn, rather than treating the parent's movement as permission to erase both.
      if (original.clinicalCrib) {
        const cribEpisode = entry.associatedClinicalCrib?.clinicalEpisodeId;
        if (
          !cribEpisode ||
          original.clinicalCrib.clinicalEpisodeId !== cribEpisode ||
          !hasConfirmedMovement(historical, {
            ...entry,
            encounterId: cribEpisode,
            expectedOccupant: { clinicalEpisodeId: cribEpisode, rut: original.clinicalCrib.rut },
          })
        ) {
          throw new Error('La cuna asociada requiere confirmar su propio egreso histórico.');
        }
      }
      if (clearHistoricalOccupants) {
        await runExclusiveDailyRecordWrite(historical.date, async historicalLease => {
          const fresh = await repository.getAuthoritativeForDate(historical.date);
          if (!fresh || !hasConfirmedMovement(fresh, entry)) throw conflict();
          const occupied = Object.entries(fresh.beds).filter(
            ([, patient]) => patient.patientName && matchesDischargeSubject(patient, entry)
          );
          if (occupied.length > 1) throw conflict();
          if (occupied.length === 0) return;
          if ((fresh as DailyRecord & { medicalSignature?: unknown }).medicalSignature) {
            throw new Error('El censo histórico fue firmado después de la revisión.');
          }
          const [bedId, patient] = occupied[0];
          if (
            patient.clinicalCrib &&
            (!entry.associatedClinicalCrib?.clinicalEpisodeId ||
              patient.clinicalCrib.clinicalEpisodeId !==
                entry.associatedClinicalCrib.clinicalEpisodeId ||
              !hasConfirmedMovement(fresh, {
                ...entry,
                expectedOccupant: {
                  clinicalEpisodeId: patient.clinicalCrib.clinicalEpisodeId,
                  rut: patient.clinicalCrib.rut,
                },
              }))
          )
            throw conflict();
          const patch: DailyRecordPatch = {};
          patch[`beds.${bedId}`] = { ...EMPTY_PATIENT, bedId };
          const write = await repository.updatePartialDetailed(fresh.date, patch, {
            baseRecord: fresh,
            intentionalBedClear: {
              bedId,
              confirmedLastUpdated: fresh.lastUpdated,
              confirmedOccupant: buildConfirmedBedOccupantIdentity(patient),
              confirmedAssociatedCrib: patient.clinicalCrib
                ? buildConfirmedAssociatedCribIdentity(patient.clinicalCrib)
                : null,
            },
            requireRemoteAuthorityFirst: true,
            requireConfirmedRecord: true,
            dailyRecordWriteLease: historicalLease,
          });
          assertRayenCensusPersistenceConfirmed({ record: fresh, result: write });
          if (
            !write.confirmedRecord ||
            write.confirmedRecord.date !== fresh.date ||
            write.confirmedRecord.beds[bedId]?.patientName ||
            write.confirmedRecord.beds[bedId]?.clinicalCrib ||
            !hasConfirmedMovement(write.confirmedRecord, entry)
          )
            throw conflict();
          await setRemoteConfirmedDailyRecordQueryData(
            queryClient,
            fresh.date,
            write.confirmedRecord
          );
        });
      }
      const current = await repository.getAuthoritativeForDate(result.record.date);
      if (!current || current.rayenSync?.runId !== result.confirmedHandoff.runId) throw conflict();
      const currentBed = current.beds[entry.bedId];
      if (!currentBed?.patientName && !currentBed?.clinicalCrib) {
        const reviewedEpisodeStillPresent = Object.values(current.beds).some(patient =>
          [patient, patient.clinicalCrib].some(
            occupant =>
              occupant?.patientName &&
              (matchesDischargeSubject(occupant, entry) ||
                (entry.associatedClinicalCrib?.clinicalEpisodeId &&
                  occupant.clinicalEpisodeId === entry.associatedClinicalCrib.clinicalEpisodeId))
          )
        );
        if (reviewedEpisodeStillPresent) throw conflict();
        confirmed = current;
        continue; // An earlier attempt committed but its response was lost.
      }
      const intent = {
        bedId: entry.bedId,
        confirmedLastUpdated: current.lastUpdated,
        confirmedOccupant: buildConfirmedBedOccupantIdentity(original),
        confirmedAssociatedCrib: original.clinicalCrib
          ? buildConfirmedAssociatedCribIdentity(original.clinicalCrib)
          : null,
      };
      if (!canRebaseIntentionalBedClear(intent, current)) throw conflict();
      const patch: DailyRecordPatch = {};
      patch[`beds.${entry.bedId}`] = { ...EMPTY_PATIENT, bedId: entry.bedId };
      const write = await repository.updatePartialDetailed(current.date, patch, {
        baseRecord: current,
        intentionalBedClear: intent,
        requireRemoteAuthorityFirst: true,
        requireConfirmedRecord: true,
        dailyRecordWriteLease,
      });
      assertRayenCensusPersistenceConfirmed({ record: current, result: write });
      if (
        !write.confirmedRecord ||
        write.confirmedRecord.date !== current.date ||
        write.confirmedRecord.rayenSync?.runId !== result.confirmedHandoff.runId ||
        write.confirmedRecord.beds[entry.bedId]?.patientName ||
        write.confirmedRecord.beds[entry.bedId]?.clinicalCrib
      )
        throw conflict();
      confirmed = write.confirmedRecord;
    }
    markDailyRecordRemoteConfirmed(confirmed.date, {
      source: 'write',
      remoteLastUpdated: confirmed.lastUpdated,
      previousRecord: result.record,
      confirmedRecord: confirmed,
    });
    await setRemoteConfirmedDailyRecordQueryData(queryClient, confirmed.date, confirmed);
    // Keep the accepted episode allowlist: a concurrently admitted patient must not inherit this
    // run's clinical capture, and discharged episodes remain excluded after finalization.
    const handoff = {
      ...result.confirmedHandoff,
      record: confirmed,
      acceptedRevision: confirmed.lastUpdated,
    };
    return {
      ...result,
      record: confirmed,
      confirmedHandoff: handoff,
      structuralStage:
        result.structuralStage.status === 'blocked'
          ? result.structuralStage
          : { ...result.structuralStage, handoff },
      deferredHistoricalDischarges: [],
    };
  });
};
