/**
 * Orchestrates a Rayen census import in the UI: subscribe to snapshots (from the
 * extension bridge), plan the diff, then either open the preview (default) or apply
 * automatically (experimental mode). Applying persists via `useSaveDailyRecordMutation`.
 *
 * Safety rail: auto mode only auto-applies when the diff has NO conflicts; otherwise
 * it falls back to the preview so a human resolves them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useSaveDailyRecordMutation } from '@/hooks/useDailyRecordQuery';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { planRayenCensusImport } from '../importRayenCensusUseCase';
import { applyCensusImportDiff, type ApplyResult } from '../domain/applyCensusImportDiff';
import { requiresReview } from '../domain/reconcileCensus';
import { subscribeToRayenSnapshots } from '../bridge/rayenImportBridge';
import { useRayenImportMode } from './useRayenImportMode';
import type { RayenCensusSnapshot } from '../contracts/rayenSnapshot';
import type { CensusImportDiff } from '../contracts/censusImportDiff';

const makeId = (): string => crypto.randomUUID();

interface RayenImportState {
  diff: CensusImportDiff | null;
  isPreviewOpen: boolean;
  isBusy: boolean;
  result: ApplyResult | null;
  error: string | null;
}

const INITIAL_STATE: RayenImportState = {
  diff: null,
  isPreviewOpen: false,
  isBusy: false,
  result: null,
  error: null,
};

export const useRayenImport = () => {
  const { mode } = useRayenImportMode();
  const dailyRecordData = useDailyRecordData();
  const saveMutation = useSaveDailyRecordMutation();
  const [state, setState] = useState<RayenImportState>(INITIAL_STATE);

  const currentRecord = dailyRecordData.record as DailyRecord | null | undefined;

  const applyDiff = useCallback(
    async (record: DailyRecord, diff: CensusImportDiff): Promise<ApplyResult> => {
      const result = applyCensusImportDiff(record, diff, { idFactory: makeId });
      await saveMutation.mutateAsync(result.record);
      return result;
    },
    [saveMutation]
  );

  const previewSnapshot = useCallback(
    (snapshot: RayenCensusSnapshot) => {
      if (!currentRecord) {
        setState(prev => ({ ...prev, error: 'No hay censo cargado para hoy.' }));
        return;
      }
      const { diff } = planRayenCensusImport({ current: currentRecord, snapshot });
      const needsReview = requiresReview(diff);
      const canAutoApply = mode === 'auto' && !needsReview;

      if (canAutoApply) {
        setState({ diff, isPreviewOpen: false, isBusy: true, result: null, error: null });
        applyDiff(currentRecord, diff)
          .then(result => setState(prev => ({ ...prev, isBusy: false, result })))
          .catch(error => setState(prev => ({ ...prev, isBusy: false, error: String(error) })));
        return;
      }

      setState({
        diff,
        isPreviewOpen: true,
        isBusy: false,
        result: null,
        error:
          mode === 'auto' && needsReview
            ? 'El modo automático requiere revisión: hay conflictos o egresos inferidos por ausencia en Rayen.'
            : null,
      });
    },
    [currentRecord, mode, applyDiff]
  );

  useEffect(() => subscribeToRayenSnapshots(previewSnapshot), [previewSnapshot]);

  const confirm = useCallback(async () => {
    if (!currentRecord || !state.diff) return;
    setState(prev => ({ ...prev, isBusy: true, error: null }));
    try {
      const result = await applyDiff(currentRecord, state.diff);
      setState(prev => ({ ...prev, isBusy: false, isPreviewOpen: false, result }));
    } catch (error) {
      setState(prev => ({ ...prev, isBusy: false, error: String(error) }));
    }
  }, [currentRecord, state.diff, applyDiff]);

  const cancel = useCallback(() => {
    setState(prev => ({ ...prev, isPreviewOpen: false }));
  }, []);

  return useMemo(
    () => ({
      mode,
      diff: state.diff,
      isPreviewOpen: state.isPreviewOpen,
      isBusy: state.isBusy,
      result: state.result,
      error: state.error,
      previewSnapshot,
      confirm,
      cancel,
    }),
    [mode, state, previewSnapshot, confirm, cancel]
  );
};
