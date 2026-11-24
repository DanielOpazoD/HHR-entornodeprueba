import type { UpcRoundEvaluation } from '@/domain/upc/upcContracts';
import type { PatientData } from '@/types/domain/patient';

import { useCallback, useMemo } from 'react';

import type { PatientFieldValue } from '@/types/valueTypes';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import type { ConfirmedBedOccupantIdentity } from '@/types/domain/intentionalBedClear';

type BedManagementDispatch = (action: BedAction) => void;
type BedManagementAsyncDispatch = (action: BedAction) => Promise<boolean>;

export const useBedManagementActionCreators = (
  dispatch: BedManagementDispatch,
  dispatchAndWait?: BedManagementAsyncDispatch
) => {
  const confirmUpcRound = useCallback(
    (evaluations: readonly UpcRoundEvaluation[]) =>
      dispatchAndWait?.({ type: 'CONFIRM_UPC_ROUND', evaluations }) ?? Promise.resolve(false),
    [dispatchAndWait]
  );
  const updatePatient = useCallback(
    (bedId: string, field: keyof PatientData, value: PatientFieldValue) => {
      dispatch({ type: 'UPDATE_PATIENT', bedId, field, value });
    },
    [dispatch]
  );

  const updatePatientMultiple = useCallback(
    (bedId: string, fields: Partial<PatientData>) => {
      if (dispatchAndWait)
        return dispatchAndWait({
          type: 'UPDATE_PATIENT_MULTIPLE',
          bedId,
          fields,
        });
      // A signed evaluation must not start if its confirmation cannot be awaited.
      if (fields.upcChecklist?.evaluatedForDate) return Promise.resolve(false);
      dispatch({
        type: 'UPDATE_PATIENT_MULTIPLE',
        bedId,
        fields,
      });
      return Promise.resolve(false);
    },
    [dispatch, dispatchAndWait]
  );

  const updateClinicalCrib = useCallback(
    (
      bedId: string,
      field: keyof PatientData | 'create' | 'remove',
      value?: PatientFieldValue,
      confirmedLastUpdated?: string,
      confirmedOccupant?: ConfirmedBedOccupantIdentity
    ) => {
      if (field === 'create') {
        dispatch({ type: 'CREATE_CLINICAL_CRIB', bedId });
        return;
      }

      if (field === 'remove') {
        const action: BedAction = {
          type: 'REMOVE_CLINICAL_CRIB',
          bedId,
          ...(confirmedLastUpdated ? { confirmedLastUpdated } : {}),
          ...(confirmedOccupant ? { confirmedOccupant } : {}),
        };
        if (dispatchAndWait) {
          return dispatchAndWait(action);
        }
        dispatch(action);
        return;
      }

      dispatch({ type: 'UPDATE_CLINICAL_CRIB', bedId, field, value: value! });
      return undefined;
    },
    [dispatch, dispatchAndWait]
  );

  const updateClinicalCribMultiple = useCallback(
    (bedId: string, fields: Partial<PatientData>) => {
      if (dispatchAndWait)
        return dispatchAndWait({
          type: 'UPDATE_CLINICAL_CRIB_MULTIPLE',
          bedId,
          fields,
        });
      if (fields.upcChecklist?.evaluatedForDate) return Promise.resolve(false);
      dispatch({
        type: 'UPDATE_CLINICAL_CRIB_MULTIPLE',
        bedId,
        fields,
      });
      return Promise.resolve(false);
    },
    [dispatch, dispatchAndWait]
  );

  const clearPatient = useCallback(
    (
      bedId: string,
      confirmedLastUpdated?: string,
      confirmedOccupant?: ConfirmedBedOccupantIdentity,
      confirmedAssociatedCrib?: ConfirmedBedOccupantIdentity | null
    ): Promise<boolean> => {
      const action: BedAction = {
        type: 'CLEAR_PATIENT',
        bedId,
        ...(confirmedLastUpdated ? { confirmedLastUpdated } : {}),
        ...(confirmedOccupant ? { confirmedOccupant } : {}),
        ...(confirmedAssociatedCrib !== undefined ? { confirmedAssociatedCrib } : {}),
      };
      if (dispatchAndWait) {
        return dispatchAndWait(action);
      }

      return Promise.resolve(false);
    },
    [dispatchAndWait]
  );

  const clearAllBeds = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL_BEDS' });
  }, [dispatch]);

  const moveOrCopyPatient = useCallback(
    (type: 'move' | 'copy', sourceBedId: string, targetBedId: string) => {
      if (type === 'move') {
        dispatch({ type: 'MOVE_PATIENT', sourceBedId, targetBedId });
        return;
      }

      dispatch({ type: 'COPY_PATIENT', sourceBedId, targetBedId });
    },
    [dispatch]
  );

  const toggleBlockBed = useCallback(
    (bedId: string, reason?: string) => {
      dispatch({ type: 'TOGGLE_BLOCK_BED', bedId, reason });
    },
    [dispatch]
  );

  const updateBlockedReason = useCallback(
    (bedId: string, reason: string) => {
      dispatch({ type: 'UPDATE_BLOCKED_REASON', bedId, reason });
    },
    [dispatch]
  );

  const toggleExtraBed = useCallback(
    (bedId: string) => {
      dispatch({ type: 'TOGGLE_EXTRA_BED', bedId });
    },
    [dispatch]
  );

  const toggleBedType = useCallback(
    (bedId: string) => {
      dispatch({ type: 'TOGGLE_BED_TYPE', bedId });
    },
    [dispatch]
  );

  return useMemo(
    () => ({
      updatePatient,
      confirmUpcRound,
      updatePatientMultiple,
      updateClinicalCrib,
      updateClinicalCribMultiple,
      clearPatient,
      clearAllBeds,
      moveOrCopyPatient,
      toggleBlockBed,
      updateBlockedReason,
      toggleExtraBed,
      toggleBedType,
    }),
    [
      confirmUpcRound,
      clearAllBeds,
      clearPatient,
      moveOrCopyPatient,
      toggleBedType,
      toggleBlockBed,
      toggleExtraBed,
      updateBlockedReason,
      updateClinicalCrib,
      updateClinicalCribMultiple,
      updatePatient,
      updatePatientMultiple,
    ]
  );
};
