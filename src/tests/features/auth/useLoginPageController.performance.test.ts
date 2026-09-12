import {
  mockExecuteGoogleSignIn,
  mockIsPopupCancellationAuthError,
  mockBeginAuthPerfAttempt,
  mockReceiveAuthPerfCredential,
  mockRecordAuthPerfEvent,
  setupLoginPageControllerTests,
} from './useLoginPageController.fixtures';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { AuthSessionState } from '@/types/authSessionTypes';
import { createCensusPerfModel } from '@/shared/runtime/censusPerfModel';
import {
  mountGoogleIdentityButton,
  type GoogleIdentityApi,
} from '@/services/auth/googleIdentityButton';
import { useLoginPageController } from '@/features/auth/components/useLoginPageController';

describe('useLoginPageController performance', () => {
  setupLoginPageControllerTests();

  it('records the popup boundary and authorized outcome before notifying the caller', async () => {
    const onLoginSuccess = vi.fn(() => {
      expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['app-attempt', 'authorized']]);
    });
    const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
    await act(() => result.current.handleGoogleSignIn());
    expect(mockBeginAuthPerfAttempt.mock.calls).toEqual([['app_button']]);
    expect(mockExecuteGoogleSignIn.mock.calls).toEqual([[undefined, 'app-attempt']]);
    expect(mockReceiveAuthPerfCredential).not.toHaveBeenCalled();
    expect(onLoginSuccess).toHaveBeenCalledOnce();
  });

  it('uses the credential boundary helper without inventing a click or auditing token/user data', async () => {
    const credential = { idToken: 'synthetic-sensitive-token', isCurrent: () => true };
    const { result } = renderHook(() => useLoginPageController(vi.fn()));
    await act(() => result.current.handleGoogleSignIn(credential));
    expect(mockExecuteGoogleSignIn).toHaveBeenCalledWith(credential, 'credential-attempt');
    // The runtime owns GIS correlation and the credential_received fallback label.
    expect(mockReceiveAuthPerfCredential.mock.calls).toEqual([[]]);
    expect(mockBeginAuthPerfAttempt).not.toHaveBeenCalled();
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['credential-attempt', 'authorized']]);
    const auditCalls = JSON.stringify([
      mockReceiveAuthPerfCredential.mock.calls,
      mockBeginAuthPerfAttempt.mock.calls,
      mockRecordAuthPerfEvent.mock.calls,
    ]);
    expect(auditCalls).not.toContain(credential.idToken);
    expect(auditCalls).not.toContain('test@hospital.cl');
  });

  it.each([true, false])(
    'correlates GIS delivery with the real metrics model (observed click: %s)',
    async clicked => {
      let sequence = 0;
      const model = createCensusPerfModel({
        now: () => 10,
        id: () => 'attempt-' + ++sequence,
        timeOrigin: 0,
        environment: 'development',
      });
      mockBeginAuthPerfAttempt.mockImplementation(model.begin);
      mockReceiveAuthPerfCredential.mockImplementation(model.receiveCredential);
      mockRecordAuthPerfEvent.mockImplementation(model.auth);
      const onLoginSuccess = vi.fn();
      const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
      const api = { initialize: vi.fn(), renderButton: vi.fn(), cancel: vi.fn() };
      const dispose = mountGoogleIdentityButton(
        api,
        document.createElement('div'),
        'test-client',
        (idToken, isCurrent) => result.current.handleGoogleSignIn({ idToken, isCurrent })
      );
      const config = api.initialize.mock.calls[0][0] as Parameters<
        GoogleIdentityApi['initialize']
      >[0];
      const button = api.renderButton.mock.calls[0][1] as Parameters<
        GoogleIdentityApi['renderButton']
      >[1];
      await act(async () => {
        if (clicked) button.click_listener?.();
        config.callback({ credential: 'synthetic-sensitive-token' });
      });
      dispose();
      expect(onLoginSuccess).toHaveBeenCalledOnce();
      const attempts = model.snapshot().authAttempts;
      expect(attempts).toEqual([
        {
          id: 'attempt-2',
          boundary: clicked ? 'google_button' : 'credential_received',
          events: { started: 10, credential_received: 10, authorized: 10 },
        },
      ]);
      expect(JSON.stringify(model.snapshot())).not.toContain('synthetic-sensitive-token');
      expect(JSON.stringify(model.snapshot())).not.toContain('test@hospital.cl');
    }
  );

  it.each([false, true])(
    'preserves legacy arguments with metrics disabled (credential: %s)',
    async hasCredential => {
      mockBeginAuthPerfAttempt.mockReturnValue(undefined);
      mockReceiveAuthPerfCredential.mockReturnValue(undefined);
      const credential = { idToken: 'synthetic-token', isCurrent: () => true };
      const { result } = renderHook(() => useLoginPageController(vi.fn()));
      await act(() => result.current.handleGoogleSignIn(hasCredential ? credential : undefined));
      expect(mockExecuteGoogleSignIn.mock.calls).toEqual(hasCredential ? [[credential]] : [[]]);
    }
  );

  it('finishes each captured attempt ID when overlapping exchanges settle out of order', async () => {
    mockBeginAuthPerfAttempt.mockReturnValueOnce('first-popup');
    mockReceiveAuthPerfCredential.mockReturnValueOnce('second-gis');
    let resolveFirst!: (
      value: ReturnType<typeof createApplicationSuccess<AuthSessionState>>
    ) => void;
    mockExecuteGoogleSignIn.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirst = resolve;
        })
    );
    mockExecuteGoogleSignIn.mockRejectedValueOnce(new Error('second failed'));
    const { result } = renderHook(() => useLoginPageController(vi.fn()));
    let first!: Promise<void>;
    await act(async () => {
      first = result.current.handleGoogleSignIn();
      await result.current.handleGoogleSignIn({
        idToken: 'synthetic-token',
        isCurrent: () => true,
      });
    });
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['second-gis', 'failed']]);
    await act(async () => {
      resolveFirst(
        createApplicationSuccess<AuthSessionState>({
          status: 'authorized',
          user: {
            uid: 'google-1',
            email: 'test@hospital.cl',
            displayName: 'Google User',
            role: 'admin',
          },
        })
      );
      await first;
    });
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([
      ['second-gis', 'failed'],
      ['first-popup', 'authorized'],
    ]);
  });

  it.each(['failed', 'thrown', 'cancelled', 'thrown-cancelled'])(
    'does not mark a %s exchange authorized',
    async failureMode => {
      const cancelled = failureMode.includes('cancelled');
      mockIsPopupCancellationAuthError.mockReturnValue(cancelled);
      if (failureMode === 'thrown' || failureMode === 'thrown-cancelled') {
        mockExecuteGoogleSignIn.mockRejectedValueOnce(new Error('exchange failed'));
      } else {
        mockExecuteGoogleSignIn.mockResolvedValueOnce(
          createApplicationFailed<AuthSessionState>({ status: 'unauthenticated', user: null }, [
            { kind: 'unknown', message: 'exchange failed' },
          ])
        );
      }
      const onLoginSuccess = vi.fn();
      const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
      await act(async () => {
        const pending = result.current.handleGoogleSignIn();
        await vi.advanceTimersByTimeAsync(600);
        await pending;
      });
      expect(mockRecordAuthPerfEvent.mock.calls).toEqual([
        ['app-attempt', cancelled ? 'cancelled' : 'failed'],
      ]);
      expect(onLoginSuccess).not.toHaveBeenCalled();
      expect(result.current.isGoogleLoading).toBe(false);
    }
  );

  it('does not infer authorization from a successful wrapper with no authorized session', async () => {
    mockExecuteGoogleSignIn.mockResolvedValueOnce(
      createApplicationSuccess<AuthSessionState>({
        status: 'unauthenticated',
        user: null,
      })
    );
    const onLoginSuccess = vi.fn();
    const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
    await act(() => result.current.handleGoogleSignIn());
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['app-attempt', 'failed']]);
    // Measurement does not change the existing controller's success handling.
    expect(onLoginSuccess).toHaveBeenCalledOnce();
  });

  it.each(['begin', 'receive', 'finish'])(
    'isolates a throwing %s audit hook from login',
    async hook => {
      const failAudit = () => {
        throw new Error('audit unavailable');
      };
      if (hook === 'begin') mockBeginAuthPerfAttempt.mockImplementationOnce(failAudit);
      if (hook === 'receive') mockReceiveAuthPerfCredential.mockImplementationOnce(failAudit);
      if (hook === 'finish') mockRecordAuthPerfEvent.mockImplementationOnce(failAudit);
      const onLoginSuccess = vi.fn();
      const { result } = renderHook(() => useLoginPageController(onLoginSuccess));
      await act(() =>
        result.current.handleGoogleSignIn(
          hook === 'receive' ? { idToken: 'synthetic-token', isCurrent: () => true } : undefined
        )
      );
      expect(mockExecuteGoogleSignIn).toHaveBeenCalledOnce();
      expect(onLoginSuccess).toHaveBeenCalledOnce();
      expect(result.current.error).toBeNull();
      expect(result.current.isGoogleLoading).toBe(false);
      expect(mockRecordAuthPerfEvent).toHaveBeenCalledOnce();
    }
  );

  it('does not finalize twice if a success callback throws after the outcome was recorded', async () => {
    const { result } = renderHook(() =>
      useLoginPageController(() => {
        throw new Error('caller failed');
      })
    );
    await act(() => result.current.handleGoogleSignIn());
    expect(mockRecordAuthPerfEvent.mock.calls).toEqual([['app-attempt', 'authorized']]);
    expect(result.current.error).toBe('caller failed');
  });
});
