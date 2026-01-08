/**
 * useWhatsAppQuery Hooks
 * TanStack Query wrappers for WhatsApp configuration and status.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    getWhatsAppConfig,
    updateWhatsAppConfig,
    checkBotHealth,
    getWhatsAppGroups
} from '../services/integrations/whatsapp/whatsappService';
import { WhatsAppConfig } from '../types';

export const whatsappKeys = {
    all: ['whatsapp'] as const,
    config: () => [...whatsappKeys.all, 'config'] as const,
    health: () => [...whatsappKeys.all, 'health'] as const,
    groups: () => [...whatsappKeys.all, 'groups'] as const,
};

/**
 * Hook to fetch WhatsApp configuration.
 */
export const useWhatsAppConfigQuery = () => {
    return useQuery({
        queryKey: whatsappKeys.config(),
        queryFn: async () => {
            const configData = await getWhatsAppConfig();
            const defaultConfig: WhatsAppConfig = {
                enabled: true,
                status: 'disconnected',
                shiftParser: {
                    enabled: false,
                    sourceGroupId: ''
                },
                handoffNotifications: {
                    enabled: true,
                    targetGroupId: '120363423199014610@g.us',
                    autoSendTime: '17:00'
                }
            };

            const mergedConfig = configData ? {
                ...defaultConfig,
                ...configData,
                shiftParser: { ...defaultConfig.shiftParser, ...configData.shiftParser },
                handoffNotifications: { ...defaultConfig.handoffNotifications, ...configData.handoffNotifications }
            } : defaultConfig;

            return mergedConfig;
        },
        staleTime: 1000 * 60 * 10, // 10 minutes
    });
};

/**
 * Hook to check the health status of the WhatsApp bot.
 */
export const useWhatsAppHealthQuery = () => {
    return useQuery({
        queryKey: whatsappKeys.health(),
        queryFn: async () => {
            const health = await checkBotHealth();
            return health.whatsapp as 'connected' | 'disconnected';
        },
        refetchInterval: 30000, // Check every 30 seconds
    });
};

/**
 * Hook to fetch WhatsApp groups.
 * Only enabled if the bot is connected.
 */
export const useWhatsAppGroupsQuery = (isEnabled: boolean) => {
    return useQuery({
        queryKey: whatsappKeys.groups(),
        queryFn: getWhatsAppGroups,
        enabled: isEnabled,
        staleTime: 1000 * 60 * 30, // 30 minutes
    });
};

/**
 * Mutation to update WhatsApp configuration.
 */
export const useUpdateWhatsAppConfigMutation = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (updatedConfig: Partial<WhatsAppConfig>) => updateWhatsAppConfig(updatedConfig),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: whatsappKeys.config() });
        },
    });
};
