/**
 * Patient History Panel Component
 * Slide-in panel showing patient hospitalization history
 * 
 * @description Shows current hospitalization, history timeline, and statistics
 * for a patient identified by RUT. Uses sub-components for each tab.
 */

import React, { useState, useEffect } from 'react';
import { X, Clock, TrendingUp, User } from 'lucide-react';
import { PatientHistory } from '../../services/patient/patientHistoryService';
import { CurrentTab, HistoryTab, StatsTab } from './tabs';

interface PatientHistoryPanelProps {
    /** Whether the panel is visible */
    isOpen: boolean;
    /** Callback to close the panel */
    onClose: () => void;
    /** Patient history data (null while loading) */
    history: PatientHistory | null;
    /** Loading state */
    isLoading: boolean;
    /** Error message if any */
    error: string | null;
    /** Current patient name (for display while loading) */
    currentPatientName?: string;
}

type TabType = 'current' | 'history' | 'stats';

/**
 * Format date string to Chilean locale
 */
const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

/**
 * Tab configuration
 */
const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'current', label: 'Actual', icon: <User size={14} /> },
    { id: 'history', label: 'Historial', icon: <Clock size={14} /> },
    { id: 'stats', label: 'Estadísticas', icon: <TrendingUp size={14} /> },
];

export const PatientHistoryPanel: React.FC<PatientHistoryPanelProps> = ({
    isOpen,
    onClose,
    history,
    isLoading,
    error,
    currentPatientName
}) => {
    const [activeTab, setActiveTab] = useState<TabType>('current');

    // Reset to current tab when opening
    useEffect(() => {
        if (isOpen) {
            setActiveTab('current');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <>
            {/* Light backdrop - click to close */}
            <div
                className="fixed inset-0 bg-slate-100/50 z-40 transition-opacity"
                onClick={onClose}
            />

            {/* Panel */}
            <div className={`fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 transform transition-transform duration-300 border-l border-slate-200 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                {/* Header - Medical teal theme matching census */}
                <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-teal-600 to-medical-600 text-white">
                    <div>
                        <h2 className="text-lg font-bold">Historial del Paciente</h2>
                        <p className="text-sm opacity-90">{currentPatientName || history?.name || 'Cargando...'}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                        aria-label="Cerrar panel"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex flex-col h-[calc(100%-80px)]">
                    {/* Loading State */}
                    {isLoading && (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center text-gray-500">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600 mx-auto mb-2"></div>
                                <p>Buscando historial...</p>
                            </div>
                        </div>
                    )}

                    {/* Error State */}
                    {error && !isLoading && (
                        <div className="flex-1 flex items-center justify-center p-4">
                            <div className="text-center text-gray-500">
                                <p className="text-red-500">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* Content with tabs */}
                    {history && !isLoading && !error && (
                        <>
                            {/* Tab Navigation */}
                            <div className="flex border-b">
                                {TABS.map(tab => (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveTab(tab.id)}
                                        className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-1.5 transition-colors ${activeTab === tab.id
                                                ? 'text-teal-700 border-b-2 border-teal-600 bg-teal-50'
                                                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                            }`}
                                        aria-selected={activeTab === tab.id}
                                    >
                                        {tab.icon}
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Tab Content */}
                            <div className="flex-1 overflow-y-auto p-4">
                                {activeTab === 'current' && (
                                    <CurrentTab history={history} formatDate={formatDate} />
                                )}
                                {activeTab === 'history' && (
                                    <HistoryTab history={history} formatDate={formatDate} />
                                )}
                                {activeTab === 'stats' && (
                                    <StatsTab history={history} />
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </>
    );
};

export default PatientHistoryPanel;
