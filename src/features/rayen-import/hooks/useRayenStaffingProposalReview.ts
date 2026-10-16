import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { NursingStaffingProposal } from '../contracts/nursingShiftInference';
import {
  hasNursingShiftReview,
  hasPendingStaffingDecision,
  reconcileNursingShiftProposal,
} from '../domain/applyNursingShiftProposal';
import { isNursingStaffingCollectionContextCurrent } from '../domain/nursingStaffingCollectionContext';
import { canWritePreviousDay } from '../domain/previousDayCorrections';
import { collectNursingStaffingProposal } from '../domain/collectNursingStaffingProposal';
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
  const mountedRef = useRef(true);
  const activeReviewRef = useRef<{
    controller: AbortController;
    date: string;
    generation: string | null;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    setStaffingProposal(null);
    setStaffingProposalError(null);
    setIsStaffingProposalBusy(false);
    return () => {
      mountedRef.current = false;
      activeReviewRef.current?.controller.abort();
      activeReviewRef.current = null;
    };
  }, [currentRecord?.date]);

  const refreshStaffingProposal = useCallback(async (): Promise<NursingStaffingProposal | null> => {
    if (!mountedRef.current) return null;
    const base = currentRecordRef.current ?? currentRecord;
    if (!base) return null;
    const generation = getSessionGeneration();
    const previous = activeReviewRef.current;
    if (previous?.date === base.date && previous.generation === generation) return null;
    previous?.controller.abort();
    const attempt = { controller: new AbortController(), date: base.date, generation };
    activeReviewRef.current = attempt;
    const isCurrent = () =>
      mountedRef.current &&
      activeReviewRef.current === attempt &&
      !attempt.controller.signal.aborted &&
      getSessionGeneration() === generation &&
      currentRecordRef.current?.date === base.date;
    const assertCurrent = () => {
      if (!isCurrent()) throw new DOMException('Staffing review superseded', 'AbortError');
    };
    setIsStaffingProposalBusy(true);
    setStaffingProposalError(null);
    try {
      const freshRecord = await loadFreshClinicalRecord(base.date);
      assertCurrent();
      const proposal = await collectNursingStaffingProposal(freshRecord, {
        fetchHistory: (encounterId, censusDate) => {
          assertCurrent();
          return requestHistoryScales(
            encounterId,
            censusDate,
            { lookbackDays: 2 },
            undefined,
            attempt.controller.signal
          );
        },
        nurseCatalog,
        tensCatalog,
        registerStaff: async observations => {
          assertCurrent();
          const registry = await import('@/services/staff/eloisaStaffRegistry');
          assertCurrent();
          return registry.registerEloisaStaff(observations);
        },
      });
      assertCurrent();
      const latestRecord = await loadFreshClinicalRecord(freshRecord.date);
      assertCurrent();
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
      if (isCurrent()) setStaffingProposalError(getRayenImportErrorMessage(error));
      return null;
    } finally {
      if (activeReviewRef.current === attempt) {
        activeReviewRef.current = null;
        if (mountedRef.current) setIsStaffingProposalBusy(false);
      }
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
