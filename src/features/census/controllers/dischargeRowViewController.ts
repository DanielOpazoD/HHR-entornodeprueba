import type { DischargeData } from '@/features/census/contracts/censusMovementContracts';
import type { DischargeRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import {
  buildDischargeRowActions,
  getDischargeStatusBadgeClassName,
} from '@/features/census/controllers/censusDischargesTableController';
import { normalizeCribDisplayText } from '@/services/terminology/cribTerminology';

interface DischargeRowActionHandlers {
  undoDischarge: (id: string) => void | Promise<void>;
  viewClinicalDocuments: (discharge: DischargeData) => void | Promise<void>;
  openHospitalizationReports: (discharge: DischargeData) => void | Promise<void>;
  editDischarge: (discharge: DischargeData) => void | Promise<void>;
  deleteDischarge: (id: string) => void | Promise<void>;
  convertDischargeToCma: (id: string) => void | Promise<void>;
  convertDischargeToTransfer?: (id: string) => void | Promise<void>;
}

export const resolveDischargeRowViewModel = (
  item: DischargeData,
  handlers: DischargeRowActionHandlers
): DischargeRowViewModel => ({
  kind: 'discharge',
  id: item.id,
  bedName: normalizeCribDisplayText(item.bedName),
  bedType: item.bedType,
  patientName: item.patientName,
  rut: item.rut,
  diagnosis: item.diagnosis,
  movementDate: item.movementDate,
  movementTime: item.time,
  movementProvenance: item.movementProvenance,
  isAssociatedClinicalCrib: item.isNested === true,
  dischargeTypeLabel:
    item.isNested === true ? 'Alta asociada · no suma egreso' : item.dischargeType || '-',
  statusLabel: item.status,
  statusBadgeClassName: getDischargeStatusBadgeClassName(item.status),
  actions: buildDischargeRowActions(item, handlers),
});
