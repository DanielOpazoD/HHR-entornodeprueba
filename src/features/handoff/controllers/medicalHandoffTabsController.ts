import type { BedDefinition } from '@/types/domain/beds';
import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';

export type MedicalPrintMode = 'all' | 'upc' | 'no-upc';
export type MedicalTabMode = 'all' | 'upc' | 'no-upc';

export const splitMedicalBedsByScope = (
  visibleBeds: BedDefinition[],
  record: HandoffDailyRecordContract
) => {
  const upcBeds = visibleBeds.filter(
    bed =>
      resolveEffectiveUpcState({
        bedId: bed.id,
        isUPC: record.beds[bed.id]?.isUPC,
        checklist: record.beds[bed.id]?.upcChecklist,
      }).isUpc
  );
  const nonUpcBeds = visibleBeds.filter(
    bed =>
      !resolveEffectiveUpcState({
        bedId: bed.id,
        isUPC: record.beds[bed.id]?.isUPC,
        checklist: record.beds[bed.id]?.upcChecklist,
      }).isUpc
  );
  return { upcBeds, nonUpcBeds };
};

export const countScopedPatients = (
  beds: BedDefinition[],
  record: HandoffDailyRecordContract
): number => beds.filter(bed => record.beds[bed.id]?.patientName).length;

export const resolveMedicalDisplayBeds = ({
  visibleBeds,
  upcBeds,
  nonUpcBeds,
  activeTab,
  fixedScope,
}: {
  visibleBeds: BedDefinition[];
  upcBeds: BedDefinition[];
  nonUpcBeds: BedDefinition[];
  activeTab: MedicalTabMode;
  fixedScope?: 'all' | 'upc' | 'no-upc' | null;
}): BedDefinition[] => {
  if (fixedScope) return visibleBeds;
  if (activeTab === 'upc') return upcBeds;
  if (activeTab === 'no-upc') return nonUpcBeds;
  return visibleBeds;
};

export const resolveMedicalPrintBeds = ({
  printMode,
  upcBeds,
  nonUpcBeds,
}: {
  printMode: MedicalPrintMode;
  upcBeds: BedDefinition[];
  nonUpcBeds: BedDefinition[];
}) => {
  if (printMode === 'upc') return { upc: upcBeds, nonUpc: [] as BedDefinition[] };
  if (printMode === 'no-upc') return { upc: [] as BedDefinition[], nonUpc: nonUpcBeds };
  return { upc: upcBeds, nonUpc: nonUpcBeds };
};

export const hasNamedPatientsInBeds = (
  beds: BedDefinition[],
  record: HandoffDailyRecordContract
): boolean => beds.some(bed => Boolean(record.beds[bed.id]?.patientName));

export const buildMedicalPrintSectionModel = (
  label: 'upc' | 'no-upc',
  beds: BedDefinition[],
  record: HandoffDailyRecordContract
): {
  title: string;
  beds: BedDefinition[];
  hasPatients: boolean;
  patientCount: number;
} => {
  const patientCount = countScopedPatients(beds, record);

  return {
    title:
      label === 'upc'
        ? `🔴 PACIENTES UPC (${patientCount})`
        : `🟢 PACIENTES NO UPC (${patientCount})`,
    beds,
    hasPatients: patientCount > 0,
    patientCount,
  };
};
