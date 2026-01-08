/**
 * WhatsApp Configuration Panel
 * 
 * Admin panel for configuring WhatsApp integration settings.
 * Refactored to use TanStack Query for state management.
 */

import React, { useState, useEffect } from 'react';
import {
    Settings,
    MessageSquare,
    Clock,
    Users,
    Check,
    X,
    RefreshCw,
    Wifi,
    WifiOff,
    Save,
    AlertCircle
} from 'lucide-react';
import {
    useWhatsAppConfigQuery,
    useWhatsAppHealthQuery,
    useWhatsAppGroupsQuery,
    useUpdateWhatsAppConfigMutation
} from '@/hooks/useWhatsAppQuery';
import type { WhatsAppConfig } from '@/types';

export const WhatsAppConfigView: React.FC = () => {
    // 1. Data Queries
    const {
        data: serverConfig,
        isLoading: loadingConfig,
        refetch: refetchConfig
    } = useWhatsAppConfigQuery();

    const {
        data: botStatus = 'disconnected',
        isLoading: checkingHealth,
        refetch: refetchHealth
    } = useWhatsAppHealthQuery();

    const {
        data: groups = [],
        isLoading: loadingGroups
    } = useWhatsAppGroupsQuery(botStatus === 'connected');

    // 2. Mutations
    const updateConfigMutation = useUpdateWhatsAppConfigMutation();

    // 3. Local state for form management (buffer)
    const [localConfig, setLocalConfig] = useState<WhatsAppConfig | null>(null);
    const [autoSendTime, setAutoSendTime] = useState('17:00');

    // Initialize local state from server data
    useEffect(() => {
        if (serverConfig) {
            setLocalConfig(serverConfig);
            setAutoSendTime(serverConfig.handoffNotifications?.autoSendTime || '17:00');
        }
    }, [serverConfig]);

    const handleRefresh = async () => {
        await Promise.all([refetchConfig(), refetchHealth()]);
    };

    const handleSave = async () => {
        if (!localConfig) return;

        const updated: Partial<WhatsAppConfig> = {
            ...localConfig,
            handoffNotifications: {
                ...localConfig.handoffNotifications,
                autoSendTime
            }
        };

        updateConfigMutation.mutate(updated);
    };

    const handleGroupChange = (type: 'shift' | 'handoff', groupId: string) => {
        if (!localConfig) return;

        if (type === 'shift') {
            setLocalConfig({
                ...localConfig,
                shiftParser: { ...localConfig.shiftParser, sourceGroupId: groupId }
            });
        } else {
            setLocalConfig({
                ...localConfig,
                handoffNotifications: { ...localConfig.handoffNotifications, targetGroupId: groupId }
            });
        }
    };

    const loading = loadingConfig || (checkingHealth && botStatus === 'disconnected');
    const saving = updateConfigMutation.isPending;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <MessageSquare className="w-6 h-6 text-green-500" />
                    <h2 className="text-xl font-semibold">Configuración WhatsApp</h2>
                </div>
                <button
                    onClick={handleRefresh}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Actualizar"
                    disabled={loading || checkingHealth}
                >
                    <RefreshCw className={clsx("w-5 h-5", (loading || checkingHealth) && "animate-spin")} />
                </button>
            </div>

            {/* Bot Status Card */}
            <div className={`p-4 rounded-lg border-2 ${botStatus === 'connected'
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50'
                }`}>
                <div className="flex items-center gap-3">
                    {botStatus === 'connected' ? (
                        <Wifi className="w-6 h-6 text-green-600" />
                    ) : (
                        <WifiOff className="w-6 h-6 text-red-600" />
                    )}
                    <div>
                        <h3 className="font-medium">
                            Estado del Bot: {botStatus === 'connected' ? 'Conectado' : 'Desconectado'}
                        </h3>
                        <p className="text-sm text-gray-600">
                            {botStatus === 'connected'
                                ? 'El bot está activo y escuchando mensajes'
                                : 'Verifica que el servidor del bot esté corriendo'}
                        </p>
                    </div>
                </div>
            </div>

            {/* Configuration Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Shift Parser Config */}
                <div className="bg-white border rounded-lg p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <Users className="w-5 h-5 text-blue-500" />
                        <h3 className="font-medium">Parser de Turnos</h3>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm">Activado</span>
                            <button
                                onClick={() => localConfig && setLocalConfig({
                                    ...localConfig,
                                    shiftParser: { ...localConfig.shiftParser, enabled: !localConfig.shiftParser.enabled }
                                })}
                                className={`w-12 h-6 rounded-full transition-colors ${localConfig?.shiftParser.enabled ? 'bg-green-500' : 'bg-gray-300'
                                    }`}
                            >
                                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${localConfig?.shiftParser.enabled ? 'translate-x-6' : 'translate-x-0.5'
                                    }`} />
                            </button>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-600 mb-1">
                                Grupo de Turnos (solo lectura)
                            </label>
                            <select
                                value={localConfig?.shiftParser.sourceGroupId || ''}
                                onChange={(e) => handleGroupChange('shift', e.target.value)}
                                className="w-full p-2 border rounded-lg text-sm"
                                disabled={botStatus !== 'connected' || loadingGroups}
                            >
                                <option value="">{loadingGroups ? 'Cargando grupos...' : 'Seleccionar grupo...'}</option>
                                {groups.map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Handoff Notifications Config */}
                <div className="bg-white border rounded-lg p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <MessageSquare className="w-5 h-5 text-green-500" />
                        <h3 className="font-medium">Notificaciones de Entrega</h3>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm">Activado</span>
                            <button
                                onClick={() => localConfig && setLocalConfig({
                                    ...localConfig,
                                    handoffNotifications: {
                                        ...localConfig.handoffNotifications,
                                        enabled: !localConfig.handoffNotifications.enabled
                                    }
                                })}
                                className={`w-12 h-6 rounded-full transition-colors ${localConfig?.handoffNotifications.enabled ? 'bg-green-500' : 'bg-gray-300'
                                    }`}
                            >
                                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${localConfig?.handoffNotifications.enabled ? 'translate-x-6' : 'translate-x-0.5'
                                    }`} />
                            </button>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-600 mb-1">
                                Grupo para Enviar Entregas
                            </label>
                            <select
                                value={localConfig?.handoffNotifications.targetGroupId || ''}
                                onChange={(e) => handleGroupChange('handoff', e.target.value)}
                                className="w-full p-2 border rounded-lg text-sm"
                                disabled={botStatus !== 'connected' || loadingGroups}
                            >
                                <option value="">{loadingGroups ? 'Cargando grupos...' : 'Seleccionar grupo...'}</option>
                                {groups.map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Auto-Send Schedule */}
            <div className="bg-white border rounded-lg p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                    <Clock className="w-5 h-5 text-orange-500" />
                    <h3 className="font-medium">Envío Automático</h3>
                </div>

                <div className="flex items-center gap-4">
                    <div>
                        <label className="block text-sm text-gray-600 mb-1">
                            Hora de envío automático
                        </label>
                        <input
                            type="time"
                            value={autoSendTime}
                            onChange={(e) => setAutoSendTime(e.target.value)}
                            className="p-2 border rounded-lg"
                        />
                    </div>
                    <div className="text-sm text-gray-500 mt-5">
                        Si no se envía manualmente, el sistema enviará automáticamente a las {autoSendTime}
                    </div>
                </div>
            </div>

            {/* Save Button & Status */}
            <div className="flex items-center justify-end gap-4">
                {updateConfigMutation.isSuccess && (
                    <div className="flex items-center gap-1.5 text-xs text-green-600 font-bold animate-pulse">
                        <Check size={14} />
                        GUARDADO CORRECTAMENTE
                    </div>
                )}
                {updateConfigMutation.isError && (
                    <div className="flex items-center gap-1.5 text-xs text-red-600 font-bold">
                        <AlertCircle size={14} />
                        FALLÓ EL GUARDADO
                    </div>
                )}
                <button
                    onClick={handleSave}
                    disabled={saving || !localConfig}
                    className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-lg shadow-blue-200"
                >
                    {saving ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                        <Save className="w-4 h-4" />
                    )}
                    Guardar Configuración
                </button>
            </div>
        </div>
    );
};

// Internal utility for class names
const clsx = (...classes: any[]) => classes.filter(Boolean).join(' ');

export default WhatsAppConfigView;
