const isTestEnvironment = (): boolean =>
  typeof process !== 'undefined' &&
  (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test');

export const logLegacyInfo = (message: string): void => {
  if (isTestEnvironment()) return;
  console.warn(message);
};

export const logLegacyError = (message: string, error: unknown): void => {
  console.error(message, error);
};
