import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveClinicalDocumentDraftLoad } from '@/features/clinical-documents/use-cases/clinicalDocumentEditorUseCases';
import {
  resolveClinicalDocumentDraftLoadAction,
  shouldApplyClinicalDocumentPendingRemoteUpdate,
} from '@/features/clinical-documents/controllers/clinicalDocumentDraftRemoteSyncController';
import { useClinicalDocumentDraftRemoteSync } from '@/features/clinical-documents/hooks/useClinicalDocumentDraftRemoteSync';

vi.mock('@/features/clinical-documents/use-cases/clinicalDocumentEditorUseCases', () => ({
  resolveClinicalDocumentDraftLoad: vi.fn(),
}));

vi.mock(
  '@/features/clinical-documents/controllers/clinicalDocumentDraftRemoteSyncController',
  () => ({
    resolveClinicalDocumentDraftLoadAction: vi.fn(),
    shouldApplyClinicalDocumentPendingRemoteUpdate: vi.fn(),
  })
);

describe('useClinicalDocumentDraftRemoteSync', () => {
  const dispatch = vi.fn();
  const draftRef = { current: null };
  const draftDirtyRef = { current: false };
  const baseStateRef = {
    current: {
      document: null,
      snapshot: '',
      updatedAt: '',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    draftRef.current = null;
    draftDirtyRef.current = false;
    baseStateRef.current = {
      document: null,
      snapshot: '',
      updatedAt: '',
    };
    vi.mocked(resolveClinicalDocumentDraftLoad).mockReturnValue({ kind: 'noop' } as never);
    vi.mocked(resolveClinicalDocumentDraftLoadAction).mockReturnValue({ kind: 'noop' } as never);
    vi.mocked(shouldApplyClinicalDocumentPendingRemoteUpdate).mockReturnValue(false);
  });

  it('dispatches the load action resolved from the current refs and documents', async () => {
    const resolution = { kind: 'selected_document' } as never;
    const action = { type: 'LOAD_DOCUMENT', document: { id: 'doc-1' } } as never;

    vi.mocked(resolveClinicalDocumentDraftLoad).mockReturnValue(resolution);
    vi.mocked(resolveClinicalDocumentDraftLoadAction).mockReturnValue({
      kind: 'dispatch',
      action,
    } as never);

    renderHook(() =>
      useClinicalDocumentDraftRemoteSync({
        documents: [{ id: 'doc-1' }] as never,
        selectedDocumentId: 'doc-1',
        hasPendingRemoteUpdate: false,
        pendingRemoteState: { document: null, snapshot: null } as never,
        dispatch,
        draftRef,
        draftDirtyRef,
        baseStateRef,
      })
    );

    await waitFor(() => {
      expect(resolveClinicalDocumentDraftLoad).toHaveBeenCalledWith({
        documents: [{ id: 'doc-1' }],
        selectedDocumentId: 'doc-1',
        currentDraft: null,
        baseState: baseStateRef.current,
        hasLocalDraftChanges: false,
      });
    });
    expect(resolveClinicalDocumentDraftLoadAction).toHaveBeenCalledWith(resolution);
    expect(dispatch).toHaveBeenCalledWith(action);
  });

  it('skips the remote update dispatch when the pending update should not be applied', () => {
    renderHook(() =>
      useClinicalDocumentDraftRemoteSync({
        documents: [],
        selectedDocumentId: null,
        hasPendingRemoteUpdate: true,
        pendingRemoteState: { document: { id: 'doc-1' }, snapshot: { savedAt: 'now' } } as never,
        dispatch,
        draftRef,
        draftDirtyRef,
        baseStateRef,
      })
    );

    expect(shouldApplyClinicalDocumentPendingRemoteUpdate).toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'APPLY_REMOTE_UPDATE' });
  });

  it('dispatches APPLY_REMOTE_UPDATE when the remote state is eligible', async () => {
    vi.mocked(shouldApplyClinicalDocumentPendingRemoteUpdate).mockReturnValue(true);

    renderHook(() =>
      useClinicalDocumentDraftRemoteSync({
        documents: [],
        selectedDocumentId: null,
        hasPendingRemoteUpdate: true,
        pendingRemoteState: { document: { id: 'doc-1' }, snapshot: { savedAt: 'now' } } as never,
        dispatch,
        draftRef,
        draftDirtyRef,
        baseStateRef,
      })
    );

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({ type: 'APPLY_REMOTE_UPDATE' });
    });
  });
});
