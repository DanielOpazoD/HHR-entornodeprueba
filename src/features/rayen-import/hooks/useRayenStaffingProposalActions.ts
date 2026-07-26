import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import {
  ensureFreshDailyRecordQuery,
  patchDailyRecordWithCompatibility,
} from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { isDailyRecordWriteBlockedResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { buildNursingShiftProposalPatch } from '../domain/applyNursingShiftProposal';
import { canWritePreviousDay } from '../domain/previousDayCorrections';
import { getRayenImportErrorMessage } from './rayenImportState';
import { reportRayenStaffingOutcome } from './useRayenFillStatus';

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
    if (!proposal) return;
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
      const patch = buildNursingShiftProposalPatch(fresh.record, proposal);
      if (!patch) {
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
      if (isDailyRecordWriteBlockedResult(result)) {
        throw new Error(result?.userSafeMessage || 'El guardado fue bloqueado.');
      }
      await ensureFreshDailyRecordQuery(
        proposal.censusDate,
        { dailyRecord, queryClient },
        'clinical_patch'
      );
      setProposal(null);
      reportRayenStaffingOutcome('resolved');
    } catch (error) {
      reportRayenStaffingOutcome('pending');
      setError(getRayenImportErrorMessage(error));
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
