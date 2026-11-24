import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextType } from '@/context/AuthContext';
import { useClinicalChecklistBridge } from '@/app-shell/runtime/useClinicalChecklistBridge';

const checklistMock = vi.hoisted(() => vi.fn());
const currentUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/clinical-checklists/checklistService', () => ({
  clinicalChecklist: checklistMock,
}));

vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    ready: Promise.resolve(),
    getCurrentUser: () => currentUserMock(),
  },
}));

describe('useClinicalChecklistBridge', () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('data-hhr-checklists-ready');
  });

  it('expone data-hhr-checklists-ready, responde solicitudes válidas y rechaza uid distinto', async () => {
    currentUserMock.mockReturnValue({ uid: 'uid-1' });
    checklistMock.mockResolvedValue({
      templates: [{ id: 't1', title: 'Pauta', version: 1, fields: [] }],
    });
    const responses: Array<Record<string, unknown>> = [];
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'HHR_CHECKLIST_RESPONSE') responses.push(event.data);
    };
    window.addEventListener('message', onMessage);

    const auth = {
      isAuthorizedSession: true,
      authorizedUser: { uid: 'uid-1' },
    } as unknown as AuthContextType;

    const { unmount } = renderHook(() => useClinicalChecklistBridge(auth));
    expect(document.documentElement.hasAttribute('data-hhr-checklists-ready')).toBe(true);

    const requestId = '11111111-1111-4111-8111-111111111111';
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: { type: 'HHR_CHECKLIST_REQUEST', requestId, request: { action: 'templates' } },
      })
    );
    await waitFor(() => expect(responses).toHaveLength(1));
    expect(responses[0]).toMatchObject({
      requestId,
      data: { templates: [{ id: 't1', title: 'Pauta', version: 1, fields: [] }] },
    });

    const mismatchId = '22222222-2222-4222-8222-222222222222';
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        origin: window.location.origin,
        data: {
          type: 'HHR_CHECKLIST_REQUEST',
          requestId: mismatchId,
          request: { action: 'apply', uid: 'uid-other' },
        },
      })
    );
    await waitFor(() => expect(responses).toHaveLength(2));
    expect(responses[1]).toMatchObject({
      requestId: mismatchId,
      error: 'Cambió la sesión de HHR.',
    });

    unmount();
    expect(document.documentElement.hasAttribute('data-hhr-checklists-ready')).toBe(false);
    window.removeEventListener('message', onMessage);
  });
});
