import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
    useWhatsAppConfigQuery,
    useWhatsAppHealthQuery,
    useWhatsAppGroupsQuery,
    useUpdateWhatsAppConfigMutation
} from '@/hooks/useWhatsAppQuery';
import * as whatsappService from '@/services/integrations/whatsapp/whatsappService';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

// Mock dependencies
vi.mock('@/services/integrations/whatsapp/whatsappService');

const createWrapper = () => createQueryClientTestWrapper().wrapper;

describe('useWhatsAppQuery Hooks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Queries', () => {
        it('useWhatsAppConfigQuery should fetch and merge config', async () => {
            const mockConfig = { enabled: false };
            vi.mocked(whatsappService.getWhatsAppConfig).mockResolvedValue(mockConfig as any);

            const { result } = renderHook(() => useWhatsAppConfigQuery(), { wrapper: createWrapper() });

            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data?.enabled).toBe(false);
            expect(result.current.data?.handoffNotifications.enabled).toBe(true); // From default
        });

        it('useWhatsAppHealthQuery should fetch health status', async () => {
            vi.mocked(whatsappService.checkBotHealth).mockResolvedValue({ whatsapp: 'connected' } as any);

            const { result } = renderHook(() => useWhatsAppHealthQuery(), { wrapper: createWrapper() });

            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toBe('connected');
        });

        it('useWhatsAppGroupsQuery should fetch groups when enabled', async () => {
            const mockGroups = [{ id: '123', name: 'Test Group' }];
            vi.mocked(whatsappService.getWhatsAppGroups).mockResolvedValue(mockGroups as any);

            const { result } = renderHook(() => useWhatsAppGroupsQuery(true), { wrapper: createWrapper() });

            await waitFor(() => expect(result.current.isSuccess).toBe(true));
            expect(result.current.data).toEqual(mockGroups);
        });
    });

    describe('Mutations', () => {
        it('useUpdateWhatsAppConfigMutation should call service', async () => {
            const updateMock = vi.mocked(whatsappService.updateWhatsAppConfig).mockResolvedValue({} as any);
            const { result } = renderHook(() => useUpdateWhatsAppConfigMutation(), { wrapper: createWrapper() });

            await result.current.mutateAsync({ enabled: true });

            expect(updateMock).toHaveBeenCalledWith({ enabled: true });
        });
    });
});
