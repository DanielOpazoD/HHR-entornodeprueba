import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useWhatsAppConfigQuery,
  useWhatsAppHealthQuery,
  useWhatsAppGroupsQuery,
  useUpdateWhatsAppConfigMutation,
} from '@/hooks/useWhatsAppQuery';
import * as whatsappService from '@/services/integrations/whatsapp/whatsappService';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import type { WhatsAppConfig } from '@/types/whatsapp';

// Mock dependencies
vi.mock('@/services/integrations/whatsapp/whatsappService');

const createWrapper = () => createQueryClientTestWrapper().wrapper;

describe('useWhatsAppQuery Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Queries', () => {
    it('useWhatsAppConfigQuery should fetch and merge config', async () => {
      const mockConfig: Partial<WhatsAppConfig> = { enabled: false };
      vi.mocked(whatsappService.getWhatsAppConfig).mockResolvedValue(
        mockConfig as Awaited<ReturnType<typeof whatsappService.getWhatsAppConfig>>
      );

      const { result } = renderHook(() => useWhatsAppConfigQuery(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.enabled).toBe(false);
      expect(result.current.data?.handoffNotifications.enabled).toBe(true); // From default
    });

    it('surfaces a failed config read as an error instead of defaults', async () => {
      vi.mocked(whatsappService.getWhatsAppConfig).mockRejectedValue(
        new Error('No se pudo leer la configuración de WhatsApp.')
      );

      const { result } = renderHook(() => useWhatsAppConfigQuery(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data).toBeUndefined();
    });

    it('useWhatsAppHealthQuery should fetch health status', async () => {
      vi.mocked(whatsappService.checkBotHealth).mockResolvedValue({
        status: 'ok',
        whatsapp: 'connected',
      } as Awaited<ReturnType<typeof whatsappService.checkBotHealth>>);

      const { result } = renderHook(() => useWhatsAppHealthQuery(), { wrapper: createWrapper() });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toBe('connected');
    });

    it('useWhatsAppGroupsQuery should fetch groups when enabled', async () => {
      const mockGroups: Awaited<ReturnType<typeof whatsappService.getWhatsAppGroups>> = [
        { id: '123', name: 'Test Group' },
      ];
      vi.mocked(whatsappService.getWhatsAppGroups).mockResolvedValue(mockGroups);

      const { result } = renderHook(() => useWhatsAppGroupsQuery(true), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockGroups);
    });
  });

  describe('Mutations', () => {
    it('useUpdateWhatsAppConfigMutation should call service', async () => {
      const updateMock = vi
        .mocked(whatsappService.updateWhatsAppConfig)
        .mockResolvedValue(undefined);
      const { result } = renderHook(() => useUpdateWhatsAppConfigMutation(), {
        wrapper: createWrapper(),
      });

      await result.current.mutateAsync({ enabled: true });

      expect(updateMock).toHaveBeenCalledWith({ enabled: true });
    });

    it('reports a failed save as an error, never as saved', async () => {
      vi.mocked(whatsappService.updateWhatsAppConfig).mockRejectedValue(
        new Error('No se pudo guardar la configuración de WhatsApp.')
      );
      const { result } = renderHook(() => useUpdateWhatsAppConfigMutation(), {
        wrapper: createWrapper(),
      });

      result.current.mutate({ enabled: true });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.isSuccess).toBe(false);
    });
  });
});
