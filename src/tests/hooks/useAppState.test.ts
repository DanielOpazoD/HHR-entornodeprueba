/**
 * useAppState Hook Tests
 *
 * Tests for the centralized UI state management hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppState } from '@/hooks/useAppState';

describe('useAppState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  describe('Module Navigation', () => {
    it('should initialize with CENSUS module', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.currentModule).toBe('CENSUS');
    });

    it('should initialize NURSING_HANDOFF for handoff deep-links', () => {
      window.history.replaceState({}, '', '/?module=NURSING_HANDOFF&date=2026-03-14');
      const { result } = renderHook(() => useAppState());
      expect(result.current.currentModule).toBe('NURSING_HANDOFF');
    });

    it('should initialize the module from a clean path slug', () => {
      window.history.replaceState({}, '', '/nursing-handoff');
      const { result } = renderHook(() => useAppState());
      expect(result.current.currentModule).toBe('NURSING_HANDOFF');
    });

    it('opens the census for an old medical handoff link or bookmark', () => {
      window.history.replaceState({}, '', '/medical-handoff?date=2026-03-14');
      expect(renderHook(() => useAppState()).result.current.currentModule).toBe('CENSUS');
      window.history.replaceState({}, '', '/?module=MEDICAL_HANDOFF&date=2026-03-14');
      expect(renderHook(() => useAppState()).result.current.currentModule).toBe('CENSUS');
    });

    it('should initialize the statistics module from its own path slug', () => {
      window.history.replaceState({}, '', '/statistics');
      const { result } = renderHook(() => useAppState());
      expect(result.current.currentModule).toBe('ANALYTICS');
    });

    it('should preserve the census date query while normalizing the census path', () => {
      window.history.replaceState({}, '', '/censo?date=2026-03-14');

      renderHook(() => useAppState());

      expect(window.location.pathname).toBe('/census');
      expect(window.location.search).toBe('?date=2026-03-14');
    });

    it('should update current module', () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.setCurrentModule('CUDYR');
      });

      expect(result.current.currentModule).toBe('CUDYR');
    });

    it('should persist the selected module as a clean path for refresh recovery', () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.setCurrentModule('NURSING_HANDOFF');
      });

      expect(window.location.pathname).toBe('/nursing-handoff');
      expect(window.location.search).toBe('');
    });

    it('should persist statistics as its own clean path', () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.setCurrentModule('ANALYTICS');
      });

      expect(window.location.pathname).toBe('/statistics');
      expect(window.location.search).toBe('');
    });

    it('should preserve the current URL when syncUrl is disabled', () => {
      window.history.replaceState(
        {},
        '',
        '/admin?mode=signature&date=2026-04-05&scope=all&token=test-token'
      );

      const { result } = renderHook(() =>
        useAppState({
          initialModule: 'MEDICAL_HANDOFF',
          syncUrl: false,
        })
      );

      act(() => {
        result.current.setCurrentModule('CENSUS');
      });

      expect(window.location.pathname).toBe('/admin');
      expect(window.location.search).toBe(
        '?mode=signature&date=2026-04-05&scope=all&token=test-token'
      );
    });
  });

  describe('Census View Mode', () => {
    it('should initialize with REGISTER view mode', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.censusViewMode).toBe('REGISTER');
    });

    it('should toggle to ANALYTICS view mode', () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.setCensusViewMode('ANALYTICS');
      });

      expect(result.current.censusViewMode).toBe('ANALYTICS');
    });
  });

  describe('Modal States', () => {
    it('should have bedManagerModal functional', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.bedManagerModal.isOpen).toBe(false);

      act(() => {
        result.current.bedManagerModal.open();
      });
      expect(result.current.bedManagerModal.isOpen).toBe(true);
    });
  });

  describe('Test Agent State', () => {
    it('should initialize isTestAgentRunning as false', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.isTestAgentRunning).toBe(false);
    });

    it('should update test agent running state', () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.setIsTestAgentRunning(true);
      });

      expect(result.current.isTestAgentRunning).toBe(true);
    });
  });

  describe('Derived State: showPrintButton', () => {
    it('should be false for CENSUS module', () => {
      const { result } = renderHook(() => useAppState());
      expect(result.current.showPrintButton).toBe(false);
    });

    it('should be true for CUDYR module', () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.setCurrentModule('CUDYR');
      });

      expect(result.current.showPrintButton).toBe(true);
    });

    it('should be true for NURSING_HANDOFF module', () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.setCurrentModule('NURSING_HANDOFF');
      });

      expect(result.current.showPrintButton).toBe(true);
    });

    it('should be false for the screenless MEDICAL_HANDOFF permission', () => {
      const { result } = renderHook(() => useAppState());

      act(() => {
        result.current.setCurrentModule('MEDICAL_HANDOFF');
      });

      expect(result.current.showPrintButton).toBe(false);
    });
  });
});
