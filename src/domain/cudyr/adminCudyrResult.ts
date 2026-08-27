export const CUDYR_RESULT_OPTIONS = [
  'A1',
  'A2',
  'A3',
  'B1',
  'B2',
  'B3',
  'C1',
  'C2',
  'C3',
  'D1',
  'D2',
  'D3',
] as const;

export type CudyrResultOption = (typeof CUDYR_RESULT_OPTIONS)[number];

export const isCudyrResultOption = (value: string): value is CudyrResultOption =>
  CUDYR_RESULT_OPTIONS.includes(value as CudyrResultOption);
