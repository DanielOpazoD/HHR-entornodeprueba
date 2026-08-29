export interface EloisaManualImportAudit {
  method: 'eloisa_manual_code';
  importedBy: string;
  importedAt: string;
  capturedAt: string;
  formatVersion: 1 | 2;
  encounterId: string;
  encounterRoute?: 'medical' | 'nurse';
  integrity: 'sha256_checksum';
  sourceTrust: 'user_confirmed_unverified';
}
