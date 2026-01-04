/**
 * WhatsApp Configuration Panel
 * 
 * Admin panel for configuring WhatsApp integration settings
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
    Save
} from 'lucide-react';
import {
    getWhatsAppConfig,
    updateWhatsAppConfig,
    checkBotHealth,
    getWhatsAppGroups
} from '@/services/integrations/whatsapp/whatsappService';
import type { WhatsAppConfig } from '@/types';

export const WhatsAppConfigView: React.FC = () => {
    const [config, setConfig] = useState<WhatsAppConfig | null>(null);
    const [botStatus, setBotStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
    const [groups, setGroups] = useState<Array<{ id: string; name: string }>>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [autoSendTime, setAutoSendTime] = useState('17:00');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        setBotStatus('checking');

        // Load config with defaults
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

        // Merge with defaults to ensure all properties exist
        const mergedConfig = configData ? {
            ...defaultConfig,
            ...configData,
            shiftParser: { ...defaultConfig.shiftParser, ...configData.shiftParser },
            handoffNotifications: { ...defaultConfig.handoffNotifications, ...configData.handoffNotifications }
        } : defaultConfig;

        setConfig(mergedConfig);
        setAutoSendTime(mergedConfig.handoffNotifications?.autoSendTime || '17:00');

        // Check bot health
        const health = await checkBotHealth();
        setBotStatus(health.whatsapp);

        // Load groups if bot is connected
        if (health.whatsapp === 'connected') {
            const groupList = await getWhatsAppGroups();
            setGroups(groupList);
        }

        setLoading(false);
    };

    const handleSave = async () => {
        if (!config) return;

        setSaving(true);
        const updated: Partial<WhatsAppConfig> = {
            ...config,
            handoffNotifications: {
                ...config.handoffNotifications,
                autoSendTime
            }
        };

        await updateWhatsAppConfig(updated);
        setSaving(false);
    };

    const handleGroupChange = (type: 'shift' | 'handoff', groupId: string) => {
        if (!config) return;

        if (type === 'shift') {
            setConfig({
                ...config,
                shiftParser: { ...config.shiftParser, sourceGroupId: groupId }
            });
        } else {
            setConfig({
                ...config,
                handoffNotifications: { ...config.handoffNotifications, targetGroupId: groupId }
            });
        }
    };

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
                    onClick={loadData}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Actualizar"
                >
                    <RefreshCw className="w-5 h-5" />
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
                                onClick={() => setConfig(config ? {
                                    ...config,
                                    shiftParser: { ...config.shiftParser, enabled: !config.shiftParser.enabled }
                                } : null)}
                                className={`w-12 h-6 rounded-full transition-colors ${config?.shiftParser.enabled ? 'bg-green-500' : 'bg-gray-300'
                                    }`}
                            >
                                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${config?.shiftParser.enabled ? 'translate-x-6' : 'translate-x-0.5'
                                    }`} />
                            </button>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-600 mb-1">
                                Grupo de Turnos (solo lectura)
                            </label>
                            <select
                                value={config?.shiftParser.sourceGroupId || ''}
                                onChange={(e) => handleGroupChange('shift', e.target.value)}
                                className="w-full p-2 border rounded-lg text-sm"
                                disabled={botStatus !== 'connected'}
                            >
                                <option value="">Seleccionar grupo...</option>
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
                                onClick={() => setConfig(config ? {
                                    ...config,
                                    handoffNotifications: {
                                        ...config.handoffNotifications,
                                        enabled: !config.handoffNotifications.enabled
                                    }
                                } : null)}
                                className={`w-12 h-6 rounded-full transition-colors ${config?.handoffNotifications.enabled ? 'bg-green-500' : 'bg-gray-300'
                                    }`}
                            >
                                <div className={`w-5 h-5 rounded-full bg-white shadow transform transition-transform ${config?.handoffNotifications.enabled ? 'translate-x-6' : 'translate-x-0.5'
                                    }`} />
                            </button>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-600 mb-1">
                                Grupo para Enviar Entregas
                            </label>
                            <select
                                value={config?.handoffNotifications.targetGroupId || ''}
                                onChange={(e) => handleGroupChange('handoff', e.target.value)}
                                className="w-full p-2 border rounded-lg text-sm"
                                disabled={botStatus !== 'connected'}
                            >
                                <option value="">Seleccionar grupo...</option>
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

            {/* Save Button */}
            <div className="flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
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

export default WhatsAppConfigView;
