import {
  CONFLICT_CONTEXT_RUNBOOK_ACTIONS,
  classifyConflictChangedContexts,
  type ConflictDomainContext,
} from '@/services/repositories/conflictResolutionDomainPolicy';

type InvariantRepairOperation = 'save' | 'updatePartial';
type InvariantRepairRiskLevel = 'low' | 'medium' | 'high';

interface BuildInvariantRepairReviewContextInput {
  date: string;
  operation: InvariantRepairOperation;
  repairPaths: string[];
  touchedPaths: string[];
}

interface InvariantRepairAssessment {
  riskLevel: InvariantRepairRiskLevel;
  reviewRecommended: boolean;
  reviewReasons: string[];
  runbookActions: string[];
}

interface InvariantRepairReviewContext extends Record<string, unknown> {
  date: string;
  operation: InvariantRepairOperation;
  patches: string[];
  repairPaths: string[];
  touchedPaths: string[];
  impactedContexts: ConflictDomainContext[];
  samplePaths: string[];
  assessment: InvariantRepairAssessment;
}

const BROAD_REPAIR_PATH_THRESHOLD = 10;
const MAX_SAMPLE_PATHS = 20;

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const classifyRepairRisk = (
  repairContexts: ConflictDomainContext[],
  touchedContexts: ConflictDomainContext[],
  repairPaths: string[]
): InvariantRepairAssessment => {
  const reviewReasons: string[] = [];
  const hasClinicalRepair = repairContexts.includes('clinical');
  const hasClinicalTouch = touchedContexts.includes('clinical');
  const hasUnknownRepair = repairContexts.includes('unknown');
  const hasNonMetadataRepair = repairContexts.some(context => context !== 'metadata');
  const isBroadRepair = repairPaths.length > BROAD_REPAIR_PATH_THRESHOLD;

  if (hasClinicalRepair) {
    reviewReasons.push('clinical_invariant_repair');
  }

  if (hasClinicalRepair && hasClinicalTouch) {
    reviewReasons.push('clinical_patch_with_structural_repair');
  }

  if (isBroadRepair) {
    reviewReasons.push('broad_invariant_repair');
  }

  if (hasUnknownRepair) {
    reviewReasons.push('unknown_repair_context');
  }

  if (hasNonMetadataRepair && reviewReasons.length === 0) {
    reviewReasons.push('non_metadata_invariant_repair');
  }

  const riskLevel: InvariantRepairRiskLevel =
    isBroadRepair || hasUnknownRepair ? 'high' : hasNonMetadataRepair ? 'medium' : 'low';

  return {
    riskLevel,
    reviewRecommended: riskLevel !== 'low' || reviewReasons.length > 0,
    reviewReasons,
    runbookActions: repairContexts.map(context => CONFLICT_CONTEXT_RUNBOOK_ACTIONS[context]),
  };
};

export const buildInvariantRepairReviewContext = ({
  date,
  operation,
  repairPaths,
  touchedPaths,
}: BuildInvariantRepairReviewContextInput): InvariantRepairReviewContext => {
  const repairContexts = classifyConflictChangedContexts(repairPaths);
  const touchedContexts = classifyConflictChangedContexts(touchedPaths);
  const impactedContexts = unique(repairContexts);

  return {
    date,
    operation,
    patches: repairPaths,
    repairPaths,
    touchedPaths,
    impactedContexts,
    samplePaths: repairPaths.slice(0, MAX_SAMPLE_PATHS),
    assessment: classifyRepairRisk(impactedContexts, touchedContexts, repairPaths),
  };
};
