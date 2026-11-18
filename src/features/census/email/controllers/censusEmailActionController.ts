export const canRunCensusEmailAction = (status: 'idle' | 'loading' | 'success' | 'error') =>
  status !== 'loading' && status !== 'success';
