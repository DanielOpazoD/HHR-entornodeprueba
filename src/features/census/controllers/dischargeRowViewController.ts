import type { DischargeData } from '@/features/census/contracts/censusMovementContracts';
import type { DischargeRowViewModel } from '@/features/census/types/censusMovementRowViewModelTypes';
import {
  buildDischargeRowActions,
  getDischargeStatusBadgeClassName,
} from '@/features/census/controllers/censusDischargesTableController';
import { normalizeCribDisplayText } from '@/services/terminology/cribTerminology';
import { resolveMovementHistoricalAdmissionDate } from '@/types/domain/movements';
import { isClinicalCribDischarge } from '@/application/census/movementTombstonePolicy';

const dischargeBedLabel = (item: DischargeData): string => {
  const name = normalizeCribDisplayText(item.bedName);
  if (!isClinicalCribDischarge(item)) return name;
  const physicalBed = name.replace(/\s*\(Cuna RN\)\s*$/i, '').replace(/^C-/i, '') || item.bedId;
  return `C-${physicalBed}`;
};

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
  bedName: dischargeBedLabel(item),
  bedType: item.bedType,
  patientName: item.patientName,
  rut: item.rut,
  admissionDate: resolveMovementHistoricalAdmissionDate(item),
  diagnosis: item.diagnosis,
  movementDate: item.movementDate,
  movementTime: item.time,
  movementProvenance: item.movementProvenance,
  isAssociatedClinicalCrib: isClinicalCribDischarge(item),
  dischargeTypeLabel:
    item.isNested === true
      ? 'Alta asociada'
      : isClinicalCribDischarge(item)
        ? 'Alta en cuna'
        : item.dischargeType || '-',
  statusLabel: item.status,
  statusBadgeClassName: getDischargeStatusBadgeClassName(item.status),
  actions: buildDischargeRowActions(item, handlers),
});
