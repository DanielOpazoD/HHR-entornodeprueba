import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import {
  ensureFreshDailyRecordQuery,
  patchDailyRecordWithCompatibility,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { isDailyRecordWriteRejectedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import {
  buildNursingShiftProposalPatch,
  reconcileNursingShiftProposal,
} from '../domain/applyNursingShiftProposal';
import { canWritePreviousDay } from '../domain/previousDayCorrections';
import { getRayenImportErrorMessage } from './rayenImportState';
import { reportRayenStaffingOutcome } from './useRayenFillStatus';
import { isNursingStaffingCollectionContextCurrent } from '../domain/nursingStaffingCollectionContext';

interface StaffingProposalActionsInput {
  proposal: NursingStaffingProposal | null;
  setProposal: Dispatch<SetStateAction<NursingStaffingProposal | null>>;
  isBusy: boolean;
  setIsBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  currentRecordRef: MutableRefObject<DailyRecord | null | undefined>;
  isAdmin: boolean;
  dailyRecord: DailyRecordRepositoryPort;
  queryClient: QueryClient;
}

export const useRayenStaffingProposalActions = ({
  proposal,
  setProposal,
  isBusy,
  setIsBusy,
  setError,
  currentRecordRef,
  isAdmin,
  dailyRecord,
  queryClient,
}: StaffingProposalActionsInput) => {
  const dismiss = useCallback(() => {
    if (isBusy) return;
    reportRayenStaffingOutcome('declined');
    setProposal(null);
    setError(null);
  }, [isBusy, setError, setProposal]);

  const confirm = useCallback(async () => {
    if (!proposal) return false;
    reportRayenStaffingOutcome('applying');
    setIsBusy(true);
    setError(null);
    try {
      if (currentRecordRef.current?.date !== proposal.censusDate) {
        throw new Error(
          'La propuesta corresponde a otra fecha del censo. Vuelve a sincronizar el día actual.'
        );
      }
      if (!canWritePreviousDay(proposal.censusDate, isAdmin)) {
        throw new Error(
          'Este censo está fuera de la ventana de edición. Solicita la actualización a un administrador.'
        );
      }
      const fresh = await ensureFreshDailyRecordQuery(
        proposal.censusDate,
        { dailyRecord, queryClient },
        'clinical_patch'
      );
      if (!fresh.record) throw new Error('No se pudo obtener la versión vigente del censo.');
      if (
        !proposal.sourceLastUpdated ||
        !isNursingStaffingCollectionContextCurrent(
          { date: proposal.censusDate, lastUpdated: proposal.sourceLastUpdated },
          fresh.record,
          currentRecordRef.current?.date
        )
      ) {
        throw new Error(
          'El censo cambió desde que se preparó la dotación. Vuelve a revisar la propuesta vigente.'
        );
      }
      // Reconcile once more against the freshly loaded roster. Clinical enrichment may have
      // updated the record while the modal was open, but an unrelated/already-resolved shift
      // must not block a still-valid nursing assignment.
      const freshProposal = reconcileNursingShiftProposal(fresh.record, proposal);
      const patch = buildNursingShiftProposalPatch(fresh.record, freshProposal);
      if (!patch) {
        const hasActionableNames = [
          freshProposal.day,
          freshProposal.night,
          freshProposal.tensDay,
          freshProposal.tensNight,
        ].some(suggestion => (suggestion?.names.length ?? 0) > 0);
        if (!hasActionableNames) {
          setProposal(null);
          reportRayenStaffingOutcome('resolved');
          return true;
        }
        throw new Error(
          'La dotación clínica ya está sincronizada o cambió mientras revisabas la propuesta. Revisa la asignación actual.'
        );
      }
      const result = await patchDailyRecordWithCompatibility(
        dailyRecord,
        proposal.censusDate,
        patch,
        { baseRecord: fresh.record }
      );
      if (result?.blockingError) throw result.blockingError;
      if (isDailyRecordWriteRejectedResult(result)) {
        throw new Error(result?.userSafeMessage || 'El guardado fue bloqueado.');
      }
      await ensureFreshDailyRecordQuery(
        proposal.censusDate,
        { dailyRecord, queryClient },
        'clinical_patch'
      );
      setProposal(null);
      reportRayenStaffingOutcome('resolved');
      return true;
    } catch (error) {
      reportRayenStaffingOutcome('pending');
      setError(getRayenImportErrorMessage(error));
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [
    currentRecordRef,
    dailyRecord,
    isAdmin,
    proposal,
    queryClient,
    setError,
    setIsBusy,
    setProposal,
  ]);

  return { confirm, dismiss };
};
