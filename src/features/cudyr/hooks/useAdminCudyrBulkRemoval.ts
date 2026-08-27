import { useMemo, useState } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { BedDefinition } from '@/types/domain/beds';
import { importedCudyrBelongsToCensus } from '@/domain/evaluationScales/importedCudyr';
import {
  adminCudyrTargetKey,
  isCudyrResultOption,
  type AdminCudyrResultAdjustment,
} from '@/domain/cudyr/adminCudyrResult';

interface UseAdminCudyrBulkRemovalInput {
  record: DailyRecord | null;
  visibleBeds: BedDefinition[];
  saveResults: (adjustments: AdminCudyrResultAdjustment[]) => Promise<boolean>;
  onSelectionInvalidated: () => void;
}

interface AdminCudyrBulkState {
  date: string | null;
  active: boolean;
  selected: Map<string, AdminCudyrResultAdjustment>;
}

const emptySelection = new Map<string, AdminCudyrResultAdjustment>();

export const useAdminCudyrBulkRemoval = ({
  record,
  visibleBeds,
  saveResults,
  onSelectionInvalidated,
}: UseAdminCudyrBulkRemovalInput) => {
  const [state, setState] = useState<AdminCudyrBulkState>(() => ({
    date: null,
    active: false,
    selected: new Map(),
  }));
  const targets = useMemo<AdminCudyrResultAdjustment[]>(() => {
    if (!record) return [];
    return visibleBeds.flatMap(bed => {
      const patient = record.beds[bed.id];
      return [
        { patient, clinicalCrib: false },
        { patient: patient?.clinicalCrib, clinicalCrib: true },
      ].flatMap(candidate => {
        const imported = candidate.patient?.evaluationScores?.cudyr;
        if (
          !candidate.patient?.clinicalEpisodeId ||
          !imported ||
          !importedCudyrBelongsToCensus(imported, record.date) ||
          !/^[A-D][1-3]$/i.test(imported.category.trim())
        ) {
          return [];
        }
        const normalizedCategory = imported.category.trim().toUpperCase();
        if (!isCudyrResultOption(normalizedCategory)) return [];
        return [
          {
            bedId: bed.id,
            clinicalCrib: candidate.clinicalCrib,
            clinicalEpisodeId: candidate.patient.clinicalEpisodeId,
            category: null,
            expectedCurrentCategory: normalizedCategory,
            expectedRecordedAt: imported.recordedAt ?? null,
            expectedRecordedDate: imported.recordedDate ?? null,
            expectedSource: imported.source ?? null,
          },
        ];
      });
    });
  }, [record, visibleBeds]);
  const targetMap = useMemo(
    () => new Map(targets.map(target => [adminCudyrTargetKey(target), target])),
    [targets]
  );
  const isActive = state.date === record?.date && state.active;
  const selected = state.date === record?.date ? state.selected : emptySelection;

  const start = () => {
    if (!record) return;
    setState({ date: record.date, active: true, selected: new Map() });
  };
  const cancel = () => {
    setState({ date: record?.date ?? null, active: false, selected: new Map() });
  };
  const selectAll = () => {
    if (!record) return;
    setState({
      date: record.date,
      active: true,
      selected: new Map(targets.map(target => [adminCudyrTargetKey(target), target])),
    });
  };
  const clearSelection = () => {
    if (!record) return;
    setState({ date: record.date, active: true, selected: new Map() });
  };
  const setTargetSelected = (key: string, shouldSelect: boolean) => {
    if (!record) return;
    setState(current => {
      const next = new Map(current.date === record.date ? current.selected : []);
      const target = targetMap.get(key);
      if (shouldSelect && target) next.set(key, target);
      else next.delete(key);
      return { date: record.date, active: true, selected: next };
    });
  };
  const confirm = async (): Promise<boolean> => {
    // Preserve the exact episode identities selected by the administrator. If the census
    // changes before confirmation, the server rejects the whole batch instead of rebinding a
    // bed key to its new occupant.
    const adjustments = [...selected.values()];
    const selectionIsCurrent = adjustments.every(adjustment => {
      const current = targetMap.get(adminCudyrTargetKey(adjustment));
      return (
        current?.clinicalEpisodeId === adjustment.clinicalEpisodeId &&
        current.expectedCurrentCategory === adjustment.expectedCurrentCategory &&
        current.expectedRecordedAt === adjustment.expectedRecordedAt &&
        current.expectedRecordedDate === adjustment.expectedRecordedDate &&
        current.expectedSource === adjustment.expectedSource
      );
    });
    if (!selectionIsCurrent) {
      onSelectionInvalidated();
      cancel();
      return false;
    }
    const saved = await saveResults(adjustments);
    if (saved) cancel();
    return saved;
  };

  return {
    targets,
    targetMap,
    isActive,
    selected,
    start,
    cancel,
    selectAll,
    clearSelection,
    setTargetSelected,
    confirm,
  };
};
