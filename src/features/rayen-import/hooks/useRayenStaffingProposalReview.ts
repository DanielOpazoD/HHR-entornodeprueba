import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import {
  hasNursingShiftReview,
  hasPendingStaffingDecision,
  reconcileNursingShiftProposal,
} from '../domain/applyNursingShiftProposal';
import { collectNursingStaffingProposal } from '../domain/collectNursingStaffingProposal';
import { isNursingStaffingCollectionContextCurrent } from '../domain/nursingStaffingCollectionContext';
import { canWritePreviousDay } from '../domain/previousDayCorrections';
import { requestHistoryScales } from '../bridge/rayenImportBridge';
import { getRayenImportErrorMessage } from './rayenImportState';
import { reportRayenStaffingOutcome } from './useRayenFillStatus';

interface UseRayenStaffingProposalReviewInput {
  currentRecord: DailyRecord | null | undefined;
  currentRecordRef: RefObject<DailyRecord | null | undefined>;
  isAdmin: boolean;
  nurseCatalog: string[];
  tensCatalog: string[];
  loadFreshClinicalRecord: (date: string) => Promise<DailyRecord>;
}

export const useRayenStaffingProposalReview = ({
  currentRecord,
  currentRecordRef,
  isAdmin,
  nurseCatalog,
  tensCatalog,
  loadFreshClinicalRecord,
}: UseRayenStaffingProposalReviewInput) => {
  const [staffingProposal, setStaffingProposal] = useState<NursingStaffingProposal | null>(null);
  const [isStaffingProposalBusy, setIsStaffingProposalBusy] = useState(false);
  const [staffingProposalError, setStaffingProposalError] = useState<string | null>(null);
  const staffingRefreshInFlightRef = useRef(false);

  useEffect(() => {
    setStaffingProposal(null);
    setStaffingProposalError(null);
  }, [currentRecord?.date]);

  const refreshStaffingProposal = useCallback(async (): Promise<NursingStaffingProposal | null> => {
    if (staffingRefreshInFlightRef.current) return null;
    staffingRefreshInFlightRef.current = true;
    setIsStaffingProposalBusy(true);
    setStaffingProposalError(null);
    try {
      const base = currentRecordRef.current ?? currentRecord;
      if (!base) throw new Error('No existe un censo abierto para revisar la dotación.');
      const freshRecord = await loadFreshClinicalRecord(base.date);
      const proposal = await collectNursingStaffingProposal(freshRecord, {
        fetchHistory: (encounterId, censusDate) =>
          requestHistoryScales(encounterId, censusDate, { lookbackDays: 2 }),
        nurseCatalog,
        tensCatalog,
      });
      const latestRecord = await loadFreshClinicalRecord(freshRecord.date);
      if (
        !isNursingStaffingCollectionContextCurrent(
          freshRecord,
          latestRecord,
          currentRecordRef.current?.date
        )
      ) {
        throw new Error(
          'El censo cambió mientras se revisaba la dotación. Vuelve a intentarlo con la versión vigente.'
        );
      }
      const reconciled = reconcileNursingShiftProposal(freshRecord, {
        ...proposal,
        sourceLastUpdated: freshRecord.lastUpdated,
      });
      if (!canWritePreviousDay(reconciled.censusDate, isAdmin)) {
        setStaffingProposal(null);
        setStaffingProposalError(
          'Este censo está fuera de la ventana de edición de dotación clínica.'
        );
        reportRayenStaffingOutcome(
          hasPendingStaffingDecision(reconciled) ? 'declined' : 'resolved'
        );
        return null;
      }
      const review = hasNursingShiftReview(reconciled) ? reconciled : null;
      setStaffingProposal(review);
      if (!review) setStaffingProposalError('No hay cambios de dotación pendientes de revisión.');
      reportRayenStaffingOutcome(
        review && hasPendingStaffingDecision(review) ? 'pending' : 'resolved'
      );
      return review;
    } catch (error) {
      setStaffingProposalError(getRayenImportErrorMessage(error));
      return null;
    } finally {
      staffingRefreshInFlightRef.current = false;
      setIsStaffingProposalBusy(false);
    }
  }, [
    currentRecord,
    currentRecordRef,
    isAdmin,
    loadFreshClinicalRecord,
    nurseCatalog,
    tensCatalog,
  ]);

  return {
    staffingProposal,
    setStaffingProposal,
    isStaffingProposalBusy,
    setIsStaffingProposalBusy,
    staffingProposalError,
    setStaffingProposalError,
    refreshStaffingProposal,
  };
};
