import type { BedDefinition } from '@/types/domain/beds';

export interface HandoffLogicViewState {
  visibleBeds: BedDefinition[];
  hasAnyPatients: boolean;
  noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift';
  deliversList: string[];
  receivesList: string[];
  tensList: string[];
}

export const buildHandoffLogicViewState = ({
  visibleBeds,
  hasAnyPatients,
  noteField,
  deliversList,
  receivesList,
  tensList,
}: HandoffLogicViewState): HandoffLogicViewState => ({
  visibleBeds,
  hasAnyPatients,
  noteField,
  deliversList,
  receivesList,
  tensList,
});
