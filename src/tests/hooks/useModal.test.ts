/**
 * Unit tests for useModal hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModal } from '@/hooks';

describe('useModal', () => {
    describe('initial state', () => {
        it('should start with isOpen false and data null', () => {
            const { result } = renderHook(() => useModal());

            expect(result.current.isOpen).toBe(false);
            expect(result.current.data).toBeNull();
        });
    });

    describe('open', () => {
        it('should set isOpen to true when open is called', () => {
            const { result } = renderHook(() => useModal());

            act(() => {
                result.current.open();
            });

            expect(result.current.isOpen).toBe(true);
        });

        it('should set data when open is called with initialData', () => {
            const { result } = renderHook(() => useModal<{ id: number }>());

            act(() => {
                result.current.open({ id: 123 });
            });

            expect(result.current.isOpen).toBe(true);
            expect(result.current.data).toEqual({ id: 123 });
        });
    });

    describe('close', () => {
        it('should set isOpen to false when close is called', () => {
            const { result } = renderHook(() => useModal());

            act(() => {
                result.current.open();
            });
            expect(result.current.isOpen).toBe(true);

            act(() => {
                result.current.close();
            });

            expect(result.current.isOpen).toBe(false);
        });

        it('should clear data after animation delay', async () => {
            vi.useFakeTimers();
            const { result } = renderHook(() => useModal<string>());

            act(() => {
                result.current.open('test data');
            });
            expect(result.current.data).toBe('test data');

            act(() => {
                result.current.close();
            });

            // Data should still exist immediately
            expect(result.current.isOpen).toBe(false);

            // Fast-forward past the animation delay
            act(() => {
                vi.advanceTimersByTime(300);
            });

            expect(result.current.data).toBeNull();

            vi.useRealTimers();
        });
    });

    describe('toggle', () => {
        it('should toggle isOpen state', () => {
            const { result } = renderHook(() => useModal());

            expect(result.current.isOpen).toBe(false);

            act(() => {
                result.current.toggle();
            });
            expect(result.current.isOpen).toBe(true);

            act(() => {
                result.current.toggle();
            });
            expect(result.current.isOpen).toBe(false);
        });
    });

    describe('type safety', () => {
        it('should work with complex data types', () => {
            interface Patient {
                id: string;
                name: string;
                age: number;
            }

            const { result } = renderHook(() => useModal<Patient>());

            const patient: Patient = { id: 'p1', name: 'John', age: 30 };

            act(() => {
                result.current.open(patient);
            });

            expect(result.current.data).toEqual(patient);
            expect(result.current.data?.name).toBe('John');
        });
    });
});
