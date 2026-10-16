import { createPortal } from 'react-dom';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { useCensusToolbarMenuTarget } from '@/shared/ui/CensusToolbarMenuTargetContext';
import type {
  CensusMedicalHandoffActionContext,
  RenderCensusMedicalHandoffAction,
} from '../contracts/censusMedicalHandoffAction';

type Props = Pick<CensusMedicalHandoffActionContext, 'visibleBeds' | 'professionalsCatalog'> & {
  renderAction: RenderCensusMedicalHandoffAction;
};

/** Only the medical handoff action needs every revision of the full record. */
export const CensusMedicalHandoffPortal = ({ renderAction, ...context }: Props) => {
  const { record } = useDailyRecordData();
  const target = useCensusToolbarMenuTarget();
  return target && record ? createPortal(renderAction({ ...context, record }), target) : null;
};
