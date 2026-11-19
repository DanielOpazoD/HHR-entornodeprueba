export type ApplicationOutcomeStatus = 'success' | 'partial' | 'degraded' | 'failed';
export type ApplicationOutcomeSeverity = 'info' | 'warning' | 'error' | 'critical';

export type ApplicationErrorKind =
  | 'validation'
  | 'permission'
  | 'not_found'
  | 'conflict'
  | 'remote_blocked'
  | 'unknown';

export interface ApplicationIssue {
  kind: ApplicationErrorKind;
  message: string;
  code?: string;
  userSafeMessage?: string;
  retryable?: boolean;
  severity?: ApplicationOutcomeSeverity;
  technicalContext?: Record<string, unknown>;
  telemetryTags?: string[];
}

export interface ApplicationOutcome<T> {
  status: ApplicationOutcomeStatus;
  data: T;
  issues: ApplicationIssue[];
  reason?: string;
  userSafeMessage?: string;
  retryable?: boolean;
  severity?: ApplicationOutcomeSeverity;
  technicalContext?: Record<string, unknown>;
  telemetryTags?: string[];
}

export interface ApplicationOutcomeMetadata {
  reason?: string;
  userSafeMessage?: string;
  retryable?: boolean;
  severity?: ApplicationOutcomeSeverity;
  technicalContext?: Record<string, unknown>;
  telemetryTags?: string[];
}

export interface UseCase<Input, Output> {
  execute(input: Input): Promise<ApplicationOutcome<Output>>;
}

export const isApplicationOutcomeSuccess = <T>(
  outcome: ApplicationOutcome<T>
): outcome is ApplicationOutcome<T> & { status: 'success' } => outcome.status === 'success';

export const isApplicationOutcomeNonFailure = <T>(
  outcome: ApplicationOutcome<T>
): outcome is ApplicationOutcome<T> & { status: 'success' | 'partial' | 'degraded' } =>
  outcome.status !== 'failed';
