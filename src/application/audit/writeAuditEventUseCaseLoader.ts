import { createApplicationFailed } from '@/shared/contracts/applicationOutcomeFactories';

export type WriteAuditEvent =
  typeof import('@/application/audit/writeAuditEventUseCase').executeWriteAuditEvent;
type WriteAuditEventUseCaseModule = Pick<
  typeof import('@/application/audit/writeAuditEventUseCase'),
  'executeWriteAuditEvent'
>;
type LoadWriteAuditEventUseCase = () => Promise<WriteAuditEventUseCaseModule>;

export const loadWriteAuditEventUseCase = () =>
  import('@/application/audit/writeAuditEventUseCase');

const buildAuditWriterLoadFailure = (error: unknown): WriteAuditEvent => {
  const message =
    error instanceof Error ? error.message : 'No se pudo cargar el escritor de auditoría.';

  return async () =>
    createApplicationFailed(null, [
      {
        kind: 'unknown',
        message,
      },
    ]);
};

export const loadExecuteWriteAuditEventFrom = async (
  loadUseCase: LoadWriteAuditEventUseCase
): Promise<WriteAuditEvent> => {
  try {
    const { executeWriteAuditEvent } = await loadUseCase();
    return executeWriteAuditEvent;
  } catch (error) {
    return buildAuditWriterLoadFailure(error);
  }
};

export const loadExecuteWriteAuditEvent = async (): Promise<WriteAuditEvent> =>
  loadExecuteWriteAuditEventFrom(loadWriteAuditEventUseCase);
