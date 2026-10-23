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
        allow create: if canWriteClinicalDocument();
        allow update: if canUpdateClinicalDocument();
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
        update: 'canUpdateClinicalDocument()',
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
      'dailyRecords create expected canEdit() && !isRayenClinicalWriteFenceActive(hospitalId) && !isSpecialtyDecisionFenceActive(hospitalId) && createsWithoutClinicalDerivedLayout() but found canReadClinicalData()'
    );
  });

  it('reports drift when a client could write server-only episode documents or drop the split-day guard', () => {
    const rules = `
      match /dailyRecords/{date} {
        allow update: if canUpdatePersistedDailyRecord() && preservesServerOwnedClinicalState(hospitalId);
      }
      match /hospitals/{hospitalId}/dailyRecords/{date}/clinicalDerived/{clinicalEpisodeId} {
        allow read: if canReadClinicalData();
        allow create, update, delete: if canEdit();
      }
    `;

    const issues = findCriticalAccessMatrixDrift(rules);
    expect(issues).toContain('clinicalDerived create expected false but found canEdit()');
    expect(issues).toContain('clinicalDerived delete expected false but found canEdit()');
    expect(issues).toContain(
      'dailyRecords update expected canUpdatePersistedDailyRecord() && preservesServerOwnedClinicalState(hospitalId) && preservesClinicalDerivedLayout() but found canUpdatePersistedDailyRecord() && preservesServerOwnedClinicalState(hospitalId)'
    );
  });
});
