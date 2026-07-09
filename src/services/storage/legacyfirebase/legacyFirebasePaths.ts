export const LEGACY_RECORD_DOC_PATHS = (date: string): string[] => [
  `hospitals/hanga_roa/dailyRecords/${date}`,
  `hospitals/hhr/dailyRecords/${date}`,
  `dailyRecords/${date}`,
  `records/${date}`,
];

export const LEGACY_RECORD_COLLECTION_PATHS: string[] = [
  'hospitals/hanga_roa/dailyRecords',
  'hospitals/hhr/dailyRecords',
  'dailyRecords',
];

export const LEGACY_DISCOVERY_COLLECTION_PATHS: string[] = [
  'hospitals/hanga_roa/dailyRecords',
  'hospitals/hhr/dailyRecords',
  'dailyRecords',
  'records',
];

export const LEGACY_NURSES_DOC_PATHS: string[] = [
  'hospitals/hanga_roa/settings/nurses',
  'hospitals/hhr/settings/nurses',
  'settings/nurses',
];

export const LEGACY_TENS_DOC_PATHS: string[] = [
  'hospitals/hanga_roa/settings/tens',
  'hospitals/hhr/settings/tens',
  'settings/tens',
];
