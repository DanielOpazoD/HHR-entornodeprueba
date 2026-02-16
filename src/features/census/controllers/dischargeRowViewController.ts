import type { DischargeData } from '@/types';
import type { DischargeRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import {
  buildDischargeRowActions,
  getDischargeStatusBadgeClassName,
} from '@/features/census/controllers/censusDischargesTableController';

interface DischargeRowActionHandlers {
  undoDischarge: (id: string) => void | Promise<void>;
  editDischarge: (discharge: DischargeData) => void | Promise<void>;
  deleteDischarge: (id: string) => void | Promise<void>;
}

export const resolveDischargeRowViewModel = (
  item: DischargeData,
  handlers: DischargeRowActionHandlers
): DischargeRowViewModel => ({
  kind: 'discharge',
  id: item.id,
  bedName: item.bedName,
  bedType: item.bedType,
  patientName: item.patientName,
  rut: item.rut,
  diagnosis: item.diagnosis,
  movementDate: item.movementDate,
  movementTime: item.time,
  dischargeTypeLabel: item.dischargeType || '-',
  statusLabel: item.status,
  statusBadgeClassName: getDischargeStatusBadgeClassName(item.status),
  actions: buildDischargeRowActions(item, handlers),
});
