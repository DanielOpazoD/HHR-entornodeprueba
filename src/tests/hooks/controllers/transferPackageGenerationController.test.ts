import { describe, expect, it, vi, beforeEach } from 'vitest';

const prepareTransferDocumentPackageMock = vi.fn();
const resolveTransferDocumentPackageApplyPlanMock = vi.fn();

vi.mock('@/hooks/controllers/transferDocumentPackageController', () => ({
  prepareTransferDocumentPackage: (...args: unknown[]) =>
    prepareTransferDocumentPackageMock(...args),
}));

vi.mock('@/hooks/controllers/transferViewStatesController', () => ({
  resolveTransferDocumentPackageApplyPlan: (...args: unknown[]) =>
    resolveTransferDocumentPackageApplyPlanMock(...args),
}));

import { executeTransferPackageGeneration } from '@/hooks/controllers/transferPackageGenerationController';
import type { TransferRequest } from '@/types/transferRequestTypes';
import type { QuestionnaireResponse } from '@/types/transferDocuments';

const baseInput = () => ({
  cache: new Map(),
  record: null,
  transfer: { id: 't1' } as TransferRequest,
  hospitalId: 'hospital-salvador',
  responses: {} as QuestionnaireResponse,
  updateTransfer: vi.fn().mockResolvedValue(undefined),
  persistResponses: false,
});

describe('executeTransferPackageGeneration', () => {
  beforeEach(() => {
    prepareTransferDocumentPackageMock.mockReset();
    resolveTransferDocumentPackageApplyPlanMock.mockReset();
  });

  it('returns message + shouldLogError + raw error when prepare fails and the plan asks to log', async () => {
    const error = new Error('boom');
    prepareTransferDocumentPackageMock.mockResolvedValueOnce({ kind: 'error', error });
    resolveTransferDocumentPackageApplyPlanMock.mockReturnValueOnce({
      kind: 'message',
      message: 'Error al generar documentos. Por favor intente nuevamente.',
      shouldLogError: true,
    });

    const outcome = await executeTransferPackageGeneration(baseInput());

    expect(outcome).toEqual({
      kind: 'message',
      message: 'Error al generar documentos. Por favor intente nuevamente.',
      shouldLogError: true,
      error,
    });
  });

  it('returns message without raw error when result is empty (plan still wants a message)', async () => {
    prepareTransferDocumentPackageMock.mockResolvedValueOnce({ kind: 'empty' });
    resolveTransferDocumentPackageApplyPlanMock.mockReturnValueOnce({
      kind: 'message',
      message: 'No fue posible preparar los documentos.',
      shouldLogError: false,
    });

    const outcome = await executeTransferPackageGeneration(baseInput());

    expect(outcome).toEqual({
      kind: 'message',
      message: 'No fue posible preparar los documentos.',
      shouldLogError: false,
      error: undefined,
    });
  });

  it('returns open-package with documents and patientData on success', async () => {
    prepareTransferDocumentPackageMock.mockResolvedValueOnce({ kind: 'success' });
    resolveTransferDocumentPackageApplyPlanMock.mockReturnValueOnce({
      kind: 'open-package',
      documents: [{ id: 'doc-1' }],
      patientData: { rut: '11.111.111-1' },
    });

    const outcome = await executeTransferPackageGeneration(baseInput());

    expect(outcome).toEqual({
      kind: 'open-package',
      documents: [{ id: 'doc-1' }],
      patientData: { rut: '11.111.111-1' },
    });
  });

  it('returns noop when the plan does not classify (defensive default)', async () => {
    prepareTransferDocumentPackageMock.mockResolvedValueOnce({ kind: 'cached' });
    resolveTransferDocumentPackageApplyPlanMock.mockReturnValueOnce({
      kind: 'unknown-future-variant',
    });

    const outcome = await executeTransferPackageGeneration(baseInput());
    expect(outcome).toEqual({ kind: 'noop' });
  });
});
