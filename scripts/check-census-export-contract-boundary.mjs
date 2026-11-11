#!/usr/bin/env node

import { runRestrictedImportCheck } from './lib/restrictedImportRunner.mjs';

runRestrictedImportCheck({
  label: 'Census export contract boundary',
  targetPaths: [
    'src/shared/contracts/serverless.ts',
    'src/services/exporters/censusMasterWorkbook.ts',
    'src/services/exporters/censusMasterExport.ts',
    'src/services/exporters/excel',
    'src/services/integrations/censusEmailRequestPayload.ts',
    'src/services/integrations/censusEmailService.ts',
  ],
  restrictedImport: '@/services/contracts/dailyRecordServiceContracts',
  allowedImporters: ['src/services/contracts/censusExportServiceContracts.ts'],
});
