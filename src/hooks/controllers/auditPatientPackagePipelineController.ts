import {
  buildClinicalAuditPatientPackages,
  type ClinicalAuditPatientPackage,
} from '@/services/admin/clinicalAuditPatientPackages';
import {
  buildIndexedClinicalAuditPatientPackages,
  buildClinicalAuditPatientPackageFilterOptions,
  buildClinicalAuditPatientPackageIntentOptions,
  filterIndexedClinicalAuditPatientPackages,
  matchesClinicalAuditPatientPackageIntent,
  type IndexedClinicalAuditPatientPackage,
  type ClinicalAuditPatientPackageFilterId,
  type ClinicalAuditPatientPackageFilterOption,
  type ClinicalAuditPatientPackageIntentId,
  type ClinicalAuditPatientPackageIntentOption,
} from '@/services/admin/clinicalAuditPatientPackageFilters';
import type { AuditLogEntry } from '@/types/auditLogTypes';

export { buildIndexedClinicalAuditPatientPackages };

export interface AuditPatientPackagePipelineParams {
  sourceLogs: AuditLogEntry[];
  searchTerm: string;
  activeFilter: ClinicalAuditPatientPackageFilterId;
  activeIntent: ClinicalAuditPatientPackageIntentId;
  currentPage: number;
  itemsPerPage: number;
}

export interface AuditPatientPackagePipelineBaseParams {
  sourceLogs: AuditLogEntry[];
}

export interface AuditPatientPackagePipelineBase {
  unfilteredPatientPackages: ClinicalAuditPatientPackage[];
  indexedPatientPackages: IndexedClinicalAuditPatientPackage[];
  patientPackageIntentOptions: ClinicalAuditPatientPackageIntentOption[];
}

export interface AuditPatientPackagePipelineQueryParams {
  base: AuditPatientPackagePipelineBase;
  searchTerm: string;
  activeFilter: ClinicalAuditPatientPackageFilterId;
  activeIntent: ClinicalAuditPatientPackageIntentId;
  currentPage: number;
  itemsPerPage: number;
}

export interface AuditPatientPackagePipelineResult {
  unfilteredPatientPackages: ClinicalAuditPatientPackage[];
  intentPatientPackages: ClinicalAuditPatientPackage[];
  patientPackages: ClinicalAuditPatientPackage[];
  paginatedPatientPackages: ClinicalAuditPatientPackage[];
  patientPackageFilterOptions: ClinicalAuditPatientPackageFilterOption[];
  patientPackageIntentOptions: ClinicalAuditPatientPackageIntentOption[];
  totalPages: number;
  activeDisplayCount: number;
}

const paginatePatientPackages = (
  patientPackages: ClinicalAuditPatientPackage[],
  currentPage: number,
  itemsPerPage: number
): ClinicalAuditPatientPackage[] => {
  const startIndex = (currentPage - 1) * itemsPerPage;
  return patientPackages.slice(startIndex, startIndex + itemsPerPage);
};

export const buildAuditPatientPackagePipelineBase = ({
  sourceLogs,
}: AuditPatientPackagePipelineBaseParams): AuditPatientPackagePipelineBase => {
  const unfilteredPatientPackages = buildClinicalAuditPatientPackages(sourceLogs);

  return {
    unfilteredPatientPackages,
    indexedPatientPackages: buildIndexedClinicalAuditPatientPackages(unfilteredPatientPackages),
    patientPackageIntentOptions:
      buildClinicalAuditPatientPackageIntentOptions(unfilteredPatientPackages),
  };
};

export const queryAuditPatientPackagePipeline = ({
  base,
  searchTerm,
  activeFilter,
  activeIntent,
  currentPage,
  itemsPerPage,
}: AuditPatientPackagePipelineQueryParams): AuditPatientPackagePipelineResult => {
  const intentPatientPackages = base.indexedPatientPackages
    .filter(({ auditPackage }) =>
      matchesClinicalAuditPatientPackageIntent(auditPackage, activeIntent)
    )
    .map(({ auditPackage }) => auditPackage);
  const patientPackageFilterOptions =
    buildClinicalAuditPatientPackageFilterOptions(intentPatientPackages);
  const patientPackages = filterIndexedClinicalAuditPatientPackages(base.indexedPatientPackages, {
    searchTerm,
    activeFilter,
    activeIntent,
  });

  return {
    unfilteredPatientPackages: base.unfilteredPatientPackages,
    intentPatientPackages,
    patientPackages,
    paginatedPatientPackages: paginatePatientPackages(patientPackages, currentPage, itemsPerPage),
    patientPackageFilterOptions,
    patientPackageIntentOptions: base.patientPackageIntentOptions,
    totalPages: Math.ceil(patientPackages.length / itemsPerPage),
    activeDisplayCount: patientPackages.length,
  };
};

export const buildAuditPatientPackagePipeline = ({
  sourceLogs,
  searchTerm,
  activeFilter,
  activeIntent,
  currentPage,
  itemsPerPage,
}: AuditPatientPackagePipelineParams): AuditPatientPackagePipelineResult =>
  queryAuditPatientPackagePipeline({
    base: buildAuditPatientPackagePipelineBase({ sourceLogs }),
    searchTerm,
    activeFilter,
    activeIntent,
    currentPage,
    itemsPerPage,
  });
