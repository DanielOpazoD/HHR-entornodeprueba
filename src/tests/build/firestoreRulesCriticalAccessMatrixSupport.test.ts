import { describe, expect, it } from 'vitest';

import {
  buildFirestoreRulesCriticalAccessMatrix,
  findCriticalAccessMatrixDrift,
} from '../../../scripts/firestoreRulesCriticalAccessMatrixSupport.mjs';

describe('firestore rules critical access matrix support', () => {
  it('tracks the expected access policy for clinically critical collections', () => {
    const matrix = buildFirestoreRulesCriticalAccessMatrix(`
      match /dailyRecords/{date} {
        allow read: if canReadClinicalData();
        allow create: if canEdit();
        allow update: if canUpdatePersistedDailyRecord();
        allow delete: if isAdmin();
      }

      match /clinicalDocuments/{documentId} {
        allow read: if canReadClinicalData();
        allow create, update: if canWriteClinicalDocument();
        allow delete: if canDeleteClinicalDocument();
      }

      match /auditLogs/{logId} {
        allow read: if canReadAppendOnlyOperationalLog();
        allow create: if canCreateAppendOnlyOperationalLogEntry();
        allow update, delete: if false;
      }
    `);

    expect(matrix).toEqual([
      {
        path: 'dailyRecords',
        read: 'canReadClinicalData()',
        create: 'canEdit()',
        update: 'canUpdatePersistedDailyRecord()',
        delete: 'isAdmin()',
      },
      {
        path: 'clinicalDocuments',
        read: 'canReadClinicalData()',
        create: 'canWriteClinicalDocument()',
        update: 'canWriteClinicalDocument()',
        delete: 'canDeleteClinicalDocument()',
      },
      {
        path: 'auditLogs',
        read: 'canReadAppendOnlyOperationalLog()',
        create: 'canCreateAppendOnlyOperationalLogEntry()',
        update: 'false',
        delete: 'false',
      },
    ]);
  });

  it('reports drift when a critical permission changes without updating the matrix', () => {
    const rules = `
      match /dailyRecords/{date} {
        allow read: if canReadClinicalData();
        allow create: if canReadClinicalData();
        allow update: if canUpdatePersistedDailyRecord();
        allow delete: if isAdmin();
      }
    `;

    expect(findCriticalAccessMatrixDrift(rules)).toContain(
      'dailyRecords create expected canEdit() && !isRayenClinicalWriteFenceActive(hospitalId) but found canReadClinicalData()'
    );
  });
});
