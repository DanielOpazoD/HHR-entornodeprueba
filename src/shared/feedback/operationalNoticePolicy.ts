export type OperationalNoticeState =
  | 'ok'
  | 'degraded'
  | 'pending'
  | 'retrying'
  | 'blocked'
  | 'read_only'
  | 'not_verified';

export interface OperationalNotice {
  channel: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  state: OperationalNoticeState;
  actionRequired: boolean;
}

export const createInfoNotice = (title: string, message: string): OperationalNotice => ({
  channel: 'info',
  title,
  message,
  state: 'ok',
  actionRequired: false,
});

export const createWarningNotice = (
  title: string,
  message: string,
  options: Partial<Pick<OperationalNotice, 'state' | 'actionRequired'>> = {}
): OperationalNotice => ({
  channel: 'warning',
  title,
  message,
  state: options.state || 'degraded',
  actionRequired: options.actionRequired ?? true,
});

export const createErrorNotice = (
  title: string,
  message: string,
  options: Partial<Pick<OperationalNotice, 'state' | 'actionRequired'>> = {}
): OperationalNotice => ({
  channel: 'error',
  title,
  message,
  state: options.state || 'blocked',
  actionRequired: options.actionRequired ?? true,
});

export const createPassiveVerificationPermissionNotice = (
  artifactLabel: string
): OperationalNotice => ({
  ...createInfoNotice(
    'Respaldo no verificable',
    `No se pudo confirmar ${artifactLabel} por permisos de Storage.`
  ),
  state: 'not_verified',
});

export const createRetryingNotice = (title: string, message: string): OperationalNotice =>
  createWarningNotice(title, message, {
    state: 'retrying',
    actionRequired: false,
  });

export const createDegradedNotice = (title: string, message: string): OperationalNotice =>
  createWarningNotice(title, message, {
    state: 'degraded',
    actionRequired: false,
  });

export const createBlockedNotice = (title: string, message: string): OperationalNotice =>
  createErrorNotice(title, message, {
    state: 'blocked',
    actionRequired: true,
  });
