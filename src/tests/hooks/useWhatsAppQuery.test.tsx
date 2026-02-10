import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
    useWhatsAppConfigQuery,
    useWhatsAppHealthQuery,
    useWhatsAppGroupsQuery,
    useUpdateWhatsAppConfigMutation
} from '@/hooks/useWhatsAppQuery';
import * as whatsappService from '@/services/integrations/whatsapp/whatsappService';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock dependencies
vi.mock('@/services/integrations/whatsapp/whatsappService');

const createTestQueryClient = () => new QueryClient({
    defaultOptions: {
        queries: { retry: false },
    },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={createTestQueryClient()}>
        {children}
    </QueryClientProvider>
);

describe('useWhatsAppQuery Hooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Queries', () => {
        it('useWhatsAppConfigQuery should fetch and merge config', async () => {
            const mockConfig = { enabled: false };
            vi.mocked(whatsappService.getWhatsAppConfig).mockResolvedValue(mockConfig as any);

            const { result } = renderHook(() => useWhatsAppConfigQuery(), { wrapper });

            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data?.enabled).toBe(false);
            expect(result.current.data?.handoffNotifications.enabled).toBe(true); // From default
        });

        it('useWhatsAppHealthQuery should fetch health status', async () => {
            vi.mocked(whatsappService.checkBotHealth).mockResolvedValue({ whatsapp: 'connected' } as any);

            const { result } = renderHook(() => useWhatsAppHealthQuery(), { wrapper });

            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toBe('connected');
        });

        it('useWhatsAppGroupsQuery should fetch groups when enabled', async () => {
            const mockGroups = [{ id: '123', name: 'Test Group' }];
            vi.mocked(whatsappService.getWhatsAppGroups).mockResolvedValue(mockGroups as any);

            const { result } = renderHook(() => useWhatsAppGroupsQuery(true), { wrapper });

            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toEqual(mockGroups);
        });
    });

    describe('Mutations', () => {
        it('useUpdateWhatsAppConfigMutation should call service', async () => {
            const updateMock = vi.mocked(whatsappService.updateWhatsAppConfig).mockResolvedValue({} as any);
            const { result } = renderHook(() => useUpdateWhatsAppConfigMutation(), { wrapper });

            await result.current.mutateAsync({ enabled: true });

            expect(updateMock).toHaveBeenCalledWith({ enabled: true });
        });
    });
});
