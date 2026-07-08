/**
 * Pure orchestrator for the "generate transfer document package" flow.
 *
 * Extracted from `useTransferViewStates.generateDocumentPackage` so the
 * decision tree (cache hit vs miss vs failure → which modal opens, which
 * error to show, whether to log) is exhaustively unit-testable without
 * rendering the transfer management screen. The hook becomes a thin
 * shell that switches over the returned action plan and dispatches to
 * setters / browser runtime.
 */

import {
  prepareTransferDocumentPackage,
  type TransferDocumentPackageCacheEntry,
} from '@/hooks/controllers/transferDocumentPackageController';
import { resolveTransferDocumentPackageApplyPlan } from '@/hooks/controllers/transferViewStatesController';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type {
  GeneratedDocument,
  QuestionnaireResponse,
  TransferPatientData,
} from '@/types/transferDocuments';
import type { TransferRequest } from '@/types/transferRequestTypes';

export interface TransferPackageGenerationInput {
  cache: Map<string, TransferDocumentPackageCacheEntry>;
  record: DailyRecord | null;
  transfer: TransferRequest;
  hospitalId: string;
  responses: QuestionnaireResponse;
  updateTransfer: (id: string, data: Partial<TransferRequest>) => Promise<void>;
  persistResponses?: boolean;
}

export type TransferPackageGenerationOutcome =
  | {
      kind: 'message';
      message: string;
      shouldLogError: boolean;
      error?: unknown;
    }
  | {
      kind: 'open-package';
      documents: GeneratedDocument[];
      patientData: TransferPatientData;
    }
  | { kind: 'noop' };

export const executeTransferPackageGeneration = async (
  input: TransferPackageGenerationInput
): Promise<TransferPackageGenerationOutcome> => {
  const result = await prepareTransferDocumentPackage(input);
  const applyPlan = resolveTransferDocumentPackageApplyPlan(result);

  if (applyPlan.kind === 'message') {
    return {
      kind: 'message',
      message: applyPlan.message,
      shouldLogError: applyPlan.shouldLogError,
      error: result.kind === 'error' ? result.error : undefined,
    };
  }

  if (applyPlan.kind === 'open-package') {
    return {
      kind: 'open-package',
      documents: applyPlan.documents,
      patientData: applyPlan.patientData,
    };
  }

  return { kind: 'noop' };
};
