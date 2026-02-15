import { renderHook } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import {
    createQueryClientTestWrapper,
    createTestQueryClient,
} from '@/tests/utils/queryClientTestUtils';

describe('queryClientTestUtils', () => {
    it('creates query clients with retry disabled by default', () => {
        const queryClient = createTestQueryClient();
        const defaults = queryClient.getDefaultOptions();

        expect(defaults.queries?.retry).toBe(false);
        expect(defaults.mutations?.retry).toBe(false);
    });

    it('merges custom query defaults while preserving retry baseline', () => {
        const queryClient = createTestQueryClient({
            defaultOptions: {
                queries: {
                    staleTime: 1234,
                },
            },
        });
        const defaults = queryClient.getDefaultOptions();

        expect(defaults.queries?.retry).toBe(false);
        expect(defaults.queries?.staleTime).toBe(1234);
    });

    it('builds a wrapper that uses the provided query client instance', () => {
        const queryClient = createTestQueryClient();
        const { wrapper } = createQueryClientTestWrapper({ queryClient });
        const { result } = renderHook(() => useQueryClient(), { wrapper });

        expect(result.current).toBe(queryClient);
    });
});
