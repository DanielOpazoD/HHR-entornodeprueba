export class DailyRecordFreshnessGateError extends Error {
  readonly presentation: 'warning' | 'silent';

  constructor(message: string, options?: { presentation?: 'warning' | 'silent' }) {
    super(message);
    this.name = 'DailyRecordFreshnessGateError';
    this.presentation = options?.presentation ?? 'warning';
  }
}
