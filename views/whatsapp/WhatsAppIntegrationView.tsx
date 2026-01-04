/**
 * WhatsApp Integration View
 * 
 * Main page for WhatsApp integration features:
 * - Configuration
 * - Shift display
 * - Message templates
 */

import React, { useState } from 'react';
import { MessageSquare, Users, FileText, Settings } from 'lucide-react';
import { WhatsAppConfigView } from './WhatsAppConfigView';
import { ShiftPanelView } from './ShiftPanelView';
import { MessageTemplatesEditor } from '@/components/whatsapp/MessageTemplatesEditor';

type TabId = 'shifts' | 'templates' | 'config';

export const WhatsAppIntegrationView: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabId>('shifts');

    const tabs = [
        { id: 'shifts' as TabId, label: 'Turnos Pabellón', icon: Users },
        { id: 'templates' as TabId, label: 'Plantillas', icon: FileText },
        { id: 'config' as TabId, label: 'Configuración', icon: Settings },
    ];

    return (
        <div className="max-w-6xl mx-auto p-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-green-100 rounded-lg">
                    <MessageSquare className="w-6 h-6 text-green-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">WhatsApp</h1>
                    <p className="text-sm text-gray-500">
                        Gestión de turnos y notificaciones
                    </p>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b mb-6">
                <nav className="flex gap-4">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${activeTab === tab.id
                                    ? 'border-green-500 text-green-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700'
                                    }`}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        );
                    })}
                </nav>
            </div>

            {/* Tab Content */}
            <div className="bg-gray-50 rounded-lg p-6 min-h-[400px]">
                {activeTab === 'shifts' && <ShiftPanelView />}
                {activeTab === 'templates' && <MessageTemplatesEditor />}
                {activeTab === 'config' && <WhatsAppConfigView />}
            </div>
        </div>
    );
};

export default WhatsAppIntegrationView;
