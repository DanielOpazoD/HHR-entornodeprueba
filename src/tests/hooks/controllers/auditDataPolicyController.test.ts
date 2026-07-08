import { describe, expect, it } from 'vitest';
import {
  buildAuditSectionActionsMap,
  buildAuditWorkerFilterParams,
  paginateAuditDisplayLogs,
  toggleAuditRowState,
} from '@/hooks/controllers/auditDataPolicyController';
import { AUDIT_SECTIONS } from '@/services/admin/auditViewConfig';
import type { AuditLogEntry } from '@/types/auditLogTypes';

describe('auditDataPolicyController', () => {
  it('builds a section-actions map from audit sections', () => {
    const sectionActions = buildAuditSectionActionsMap(AUDIT_SECTIONS);

    expect(sectionActions.ALL).toBeUndefined();
    expect(sectionActions.SESSIONS).toEqual(AUDIT_SECTIONS.SESSIONS.actions);
  });

  it('keeps daily census clinical actions classified under the census section', () => {
    expect(AUDIT_SECTIONS.CENSUS.actions).toEqual(
      expect.arrayContaining([
        'PATIENT_BED_CHANGED',
        'PATIENT_DIAGNOSIS_CHANGED',
        'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED',
        'PATIENT_NOTE_UPDATED',
        'PATIENT_SPECIALTY_CHANGED',
        'CLINICAL_EVENT_ADDED',
        'CLINICAL_EVENT_UPDATED',
        'CLINICAL_EVENT_DELETED',
        'PREVIOUS_DAY_EDIT_CONFIRMED',
        'CONFLICT_AUTO_MERGED',
        'CONFLICT_VERSION_RESTORED',
      ])
    );
  });

  it('separates clinical edits from visualization-only audit actions', () => {
    expect(AUDIT_SECTIONS.CLINICAL_EDITS.actions).toEqual(
      expect.arrayContaining([
        'PATIENT_MODIFIED',
        'PATIENT_DIAGNOSIS_CHANGED',
        'PATIENT_BED_CHANGED',
        'PATIENT_DISCHARGED',
        'MEDICAL_HANDOFF_MODIFIED',
      ])
    );
    expect(AUDIT_SECTIONS.CLINICAL_EDITS.actions).not.toContain('VIEW_PATIENT');

    expect(AUDIT_SECTIONS.VIEW_ACTIVITY.actions).toEqual(
      expect.arrayContaining(['VIEW_PATIENT', 'VIEW_CUDYR', 'VIEW_NURSING_HANDOFF'])
    );
    expect(AUDIT_SECTIONS.VIEW_ACTIVITY.actions).not.toContain('PATIENT_MODIFIED');
  });

  it('adds dedicated categories for documents and medication workflows', () => {
    expect(AUDIT_SECTIONS.CLINICAL_DOCUMENTS.actions).toEqual(
      expect.arrayContaining([
        'CLINICAL_DOCUMENT_CREATED',
        'CLINICAL_DOCUMENT_EDITED',
        'CLINICAL_DOCUMENT_PRINTED',
      ])
    );
    expect(AUDIT_SECTIONS.MEDICATIONS.actions).toEqual(
      expect.arrayContaining([
        'PRESCRIPTION_MANUAL_DELETED',
        'MEDICAL_INDICATION_RECORD_CREATED',
        'MEDICAL_INDICATION_TEMPLATE_USED',
      ])
    );
  });

  it('builds stable worker filter params', () => {
    expect(
      buildAuditWorkerFilterParams({
        searchTerm: 'ana',
        filterAction: 'ALL',
        startDate: '2026-04-01',
        endDate: '2026-04-02',
        activeSection: 'SESSIONS',
        sectionActions: { SESSIONS: ['USER_LOGIN'] },
        groupedView: true,
      })
    ).toEqual({
      searchTerm: 'ana',
      filterAction: 'ALL',
      startDate: '2026-04-01',
      endDate: '2026-04-02',
      activeSection: 'SESSIONS',
      sectionActions: { SESSIONS: ['USER_LOGIN'] },
      groupedView: true,
    });
  });

  it('paginates display logs using page and page size', () => {
    const logs = Array.from({ length: 5 }, (_, index) => ({ id: `${index}` }) as AuditLogEntry);

    expect(paginateAuditDisplayLogs(logs, 2, 2).map(log => log.id)).toEqual(['2', '3']);
  });

  it('toggles row ids in a set immutably', () => {
    const initial = new Set(['a']);
    const added = toggleAuditRowState(initial, 'b');
    const removed = toggleAuditRowState(added, 'a');

    expect(initial.has('b')).toBe(false);
    expect(added.has('a')).toBe(true);
    expect(added.has('b')).toBe(true);
    expect(removed.has('a')).toBe(false);
    expect(removed.has('b')).toBe(true);
  });
});
