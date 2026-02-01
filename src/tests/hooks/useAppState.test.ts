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
    });

    describe('Module Navigation', () => {
        it('should initialize with CENSUS module', () => {
            const { result } = renderHook(() => useAppState());
            expect(result.current.currentModule).toBe('CENSUS');
        });

        it('should update current module', () => {
            const { result } = renderHook(() => useAppState());

            act(() => {
                result.current.setCurrentModule('CUDYR');
            });

            expect(result.current.currentModule).toBe('CUDYR');
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
        it('should have settingsModal with isOpen false initially', () => {
            const { result } = renderHook(() => useAppState());
            expect(result.current.settingsModal.isOpen).toBe(false);
        });

        it('should open settings modal', () => {
            const { result } = renderHook(() => useAppState());

            act(() => {
                result.current.settingsModal.open();
            });

            expect(result.current.settingsModal.isOpen).toBe(true);
        });

        it('should close settings modal', () => {
            const { result } = renderHook(() => useAppState());

            act(() => {
                result.current.settingsModal.open();
            });
            expect(result.current.settingsModal.isOpen).toBe(true);

            act(() => {
                result.current.settingsModal.close();
            });
            expect(result.current.settingsModal.isOpen).toBe(false);
        });

        it('should have bedManagerModal functional', () => {
            const { result } = renderHook(() => useAppState());
            expect(result.current.bedManagerModal.isOpen).toBe(false);

            act(() => {
                result.current.bedManagerModal.open();
            });
            expect(result.current.bedManagerModal.isOpen).toBe(true);
        });

        it('should have demoModal functional', () => {
            const { result } = renderHook(() => useAppState());
            expect(result.current.demoModal.isOpen).toBe(false);

            act(() => {
                result.current.demoModal.open();
            });
            expect(result.current.demoModal.isOpen).toBe(true);
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

        it('should be true for MEDICAL_HANDOFF module', () => {
            const { result } = renderHook(() => useAppState());

            act(() => {
                result.current.setCurrentModule('MEDICAL_HANDOFF');
            });

            expect(result.current.showPrintButton).toBe(true);
        });
    });
});
