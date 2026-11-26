// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  resolveClinicalDocumentDraftLoadAction,
  shouldApplyClinicalDocumentPendingRemoteUpdate,
} from '@/features/clinical-documents/controllers/clinicalDocumentDraftRemoteSyncController';
import { createClinicalDocumentDraft } from '@/features/clinical-documents/domain/factories';
import { serializeClinicalDocument } from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import type { ClinicalDocumentDraftBaseState } from '@/features/clinical-documents/hooks/clinicalDocumentDraftReducer';

const buildDocument = () =>
  createClinicalDocumentDraft({
    templateId: 'evolucion',
    hospitalId: 'hhr',
    actor: {
      uid: 'u1',
      email: 'doctor@test.com',
      displayName: 'Doctor Test',
      role: 'medico',
    },
    episode: {
      patientRut: '11.111.111-1',
      patientName: 'Paciente Test',
      episodeKey: 'episodio-1',
      admissionDate: '2026-04-15',
      sourceDailyRecordDate: '2026-04-15',
      sourceBedId: 'R1',
      specialty: 'Medicina',
    },
    patientFieldValues: {},
    medico: 'Doctor Test',
    especialidad: 'Medicina',
  });

const buildBaseState = (document = buildDocument()): ClinicalDocumentDraftBaseState => ({
  document,
  snapshot: serializeClinicalDocument(document),
  updatedAt: document.audit.updatedAt,
});

describe('clinicalDocumentDraftRemoteSyncController', () => {
  it('maps preserve to noop', () => {
    expect(resolveClinicalDocumentDraftLoadAction({ kind: 'preserve' })).toEqual({
      kind: 'noop',
    });
  });

  it('maps clear to a load-document reset action', () => {
    expect(resolveClinicalDocumentDraftLoadAction({ kind: 'clear' })).toEqual({
      kind: 'dispatch',
      action: { type: 'LOAD_DOCUMENT', document: null, snapshot: '' },
    });
  });

  it('maps stage_remote to REMOTE_UPDATE_RECEIVED', () => {
    const document = buildDocument();
    const snapshot = serializeClinicalDocument(document);

    expect(
      resolveClinicalDocumentDraftLoadAction({
        kind: 'stage_remote',
        document,
        snapshot,
      })
    ).toEqual({
      kind: 'dispatch',
      action: { type: 'REMOTE_UPDATE_RECEIVED', document, snapshot },
    });
  });

  it('applies pending remote updates only when the staged snapshot is complete and the draft is clean', () => {
    expect(
      shouldApplyClinicalDocumentPendingRemoteUpdate({
        hasPendingRemoteUpdate: true,
        hasLocalDraftChanges: false,
        pendingRemoteState: buildBaseState(),
      })
    ).toBe(true);

    expect(
      shouldApplyClinicalDocumentPendingRemoteUpdate({
        hasPendingRemoteUpdate: true,
        hasLocalDraftChanges: true,
        pendingRemoteState: buildBaseState(),
      })
    ).toBe(false);

    expect(
      shouldApplyClinicalDocumentPendingRemoteUpdate({
        hasPendingRemoteUpdate: false,
        hasLocalDraftChanges: false,
        pendingRemoteState: buildBaseState(),
      })
    ).toBe(false);

    expect(
      shouldApplyClinicalDocumentPendingRemoteUpdate({
        hasPendingRemoteUpdate: true,
        hasLocalDraftChanges: false,
        pendingRemoteState: {
          document: null,
          snapshot: '',
          updatedAt: '',
        },
      })
    ).toBe(false);
  });
});
