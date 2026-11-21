import { useMemo } from 'react';
import { useCensusViewModel } from '@/features/census/hooks/useCensusViewModel';
import {
  buildEmptyDayPromptProps,
  buildRegisterContentProps,
  resolveCensusViewBranch,
} from '@/features/census/controllers/censusViewController';
import type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
import type { RenderCensusMedicalHandoffAction } from '@/features/census/contracts/censusMedicalHandoffAction';

interface UseCensusViewRouteModelParams {
  selectedDay: number;
  selectedMonth: number;
  currentDateString: string;
  showBedManagerModal: boolean;
  onCloseBedManagerModal: () => void;
  renderMedicalHandoffAction?: RenderCensusMedicalHandoffAction;
  readOnly: boolean;
  accessProfile: CensusAccessProfile;
}

export const useCensusViewRouteModel = ({
  selectedDay,
  selectedMonth,
  currentDateString,
  showBedManagerModal,
  onCloseBedManagerModal,
  renderMedicalHandoffAction,
  readOnly,
  accessProfile,
}: UseCensusViewRouteModelParams) => {
  const viewModel = useCensusViewModel(currentDateString);

  const branch = useMemo(
    () =>
      resolveCensusViewBranch({
        beds: viewModel.beds,
      }),
    [viewModel.beds]
  );

  const emptyDayPromptProps = useMemo(() => {
    if (branch !== 'empty') {
      return null;
    }

    return buildEmptyDayPromptProps({
      selectedDay,
      selectedMonth,
      currentDateString,
      previousRecordAvailable: viewModel.previousRecordAvailable,
      previousRecordDate: viewModel.previousRecordDate,
      onCreateDay: viewModel.createDay,
      readOnly,
    });
  }, [
    branch,
    currentDateString,
    readOnly,
    selectedDay,
    selectedMonth,
    viewModel.createDay,
    viewModel.previousRecordAvailable,
    viewModel.previousRecordDate,
  ]);

  const registerContentProps = useMemo(() => {
    if (branch !== 'register' || !viewModel.beds) {
      return null;
    }

    return buildRegisterContentProps({
      currentDateString,
      readOnly,
      beds: viewModel.beds,
      visibleBeds: viewModel.visibleBeds,
      marginStyle: viewModel.marginStyle,
      stats: viewModel.stats,
      showBedManagerModal,
      onCloseBedManagerModal,
      renderMedicalHandoffAction,
      accessProfile,
    });
  }, [
    accessProfile,
    branch,
    currentDateString,
    onCloseBedManagerModal,
    renderMedicalHandoffAction,
    readOnly,
    showBedManagerModal,
    viewModel.beds,
    viewModel.marginStyle,
    viewModel.stats,
    viewModel.visibleBeds,
  ]);

  return {
    branch,
    emptyDayPromptProps,
    registerContentProps,
  };
};
