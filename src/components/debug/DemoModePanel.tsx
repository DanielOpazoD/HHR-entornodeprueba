/**
 * Demo Mode Panel
 * UI component for managing demo/test mode with period selection.
 */

import React, { useState } from 'react';
import { FlaskConical, Play, Trash2, X, Calendar, Loader2 } from 'lucide-react';
import { useDemoMode, DemoPeriod } from '@/context/DemoModeContext';
import {
    saveDemoRecords,
    clearAllDemoData,
    getAllDemoDates
} from '@/services/storage/localStorageService';
import {
    generateDemoForDay,
    generateDemoForWeek,
    generateDemoForMonth
} from '@/services/utils/demoDataGenerator';

interface DemoModePanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export const DemoModePanel: React.FC<DemoModePanelProps> = ({ isOpen, onClose }) => {
    const { isActive, period, startDate, isGenerating, activateDemo, deactivateDemo, setGenerating } = useDemoMode();
    const [selectedPeriod, setSelectedPeriod] = useState<DemoPeriod>(period);
    const [selectedDate, setSelectedDate] = useState(startDate);
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [generationStatus, setGenerationStatus] = useState<string>('');

    const demoDates = getAllDemoDates();
    const hasExistingDemoData = demoDates.length > 0;

    const handleGenerate = async () => {
        setGenerating(true);
        setGenerationStatus('Generando datos...');

        // Use setTimeout to allow UI to update
        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            let records;

            if (selectedPeriod === 'day') {
                setGenerationStatus('Generando día...');
                records = generateDemoForDay(selectedDate);
            } else if (selectedPeriod === 'week') {
                setGenerationStatus('Generando semana (7 días)...');
                records = generateDemoForWeek(selectedDate);
            } else {
                const [year, month] = selectedMonth.split('-').map(Number);
                setGenerationStatus(`Generando mes completo (${new Date(year, month - 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' })})...`);
                records = generateDemoForMonth(year, month - 1);
            }

            saveDemoRecords(records);
            activateDemo(selectedPeriod, records[0].date);
            setGenerationStatus(`✓ ${records.length} día(s) generado(s)`);

            // Close panel after short delay
            setTimeout(() => {
                onClose();
            }, 1000);

        } catch (error) {
            console.error('Error generating demo data:', error);
            setGenerationStatus('Error al generar datos');
        } finally {
            setGenerating(false);
        }
    };

    const handleClearData = () => {
        if (window.confirm('¿Eliminar todos los datos demo? Esta acción no afecta los datos reales.')) {
            clearAllDemoData();
            deactivateDemo();
            setGenerationStatus('Datos demo eliminados');
        }
    };

    const handleDeactivate = () => {
        deactivateDemo();
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FlaskConical size={28} />
                            <div>
                                <h2 className="text-xl font-bold">Modo Demo</h2>
                                <p className="text-purple-200 text-sm">Datos de prueba aislados</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Status indicator */}
                    {isActive && (
                        <div className="flex items-center gap-3 p-4 bg-purple-50 rounded-xl border border-purple-200">
                            <div className="w-3 h-3 bg-purple-500 rounded-full animate-pulse" />
                            <div>
                                <p className="font-medium text-purple-900">Modo Demo Activo</p>
                                <p className="text-sm text-purple-600">
                                    {demoDates.length} día(s) • {demoDates[0]} - {demoDates[demoDates.length - 1]}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Period Selection */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Período a Generar
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {(['day', 'week', 'month'] as DemoPeriod[]).map((p) => (
                                <button
                                    key={p}
                                    onClick={() => setSelectedPeriod(p)}
                                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-all ${selectedPeriod === p
                                        ? 'bg-purple-600 text-white shadow-md'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                >
                                    {p === 'day' && '1 Día'}
                                    {p === 'week' && '7 Días'}
                                    {p === 'month' && 'Mes'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Date Selection */}
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            <Calendar size={14} className="inline mr-1" />
                            {selectedPeriod === 'month' ? 'Mes' : 'Fecha de Inicio'}
                        </label>
                        {selectedPeriod === 'month' ? (
                            <input
                                type="month"
                                value={selectedMonth}
                                onChange={(e) => setSelectedMonth(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                        ) : (
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                        )}
                    </div>

                    {/* Status Message */}
                    {generationStatus && (
                        <div className={`text-sm p-3 rounded-lg ${generationStatus.includes('Error')
                            ? 'bg-red-50 text-red-700'
                            : generationStatus.includes('✓')
                                ? 'bg-green-50 text-green-700'
                                : 'bg-blue-50 text-blue-700'
                            }`}>
                            {generationStatus}
                        </div>
                    )}

                    {/* Info box */}
                    <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                        <p className="text-sm text-amber-800">
                            <strong>Nota:</strong> Los datos demo se almacenan por separado.
                            Al desactivar el modo demo, sus datos reales estarán intactos.
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="p-6 bg-slate-50 border-t border-slate-200 space-y-3">
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating}
                        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-xl font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                Generando...
                            </>
                        ) : (
                            <>
                                <Play size={18} />
                                Generar Datos Demo
                            </>
                        )}
                    </button>

                    <div className="flex gap-3">
                        {isActive && (
                            <button
                                onClick={handleDeactivate}
                                className="flex-1 px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-medium hover:bg-slate-300 transition-colors"
                            >
                                Desactivar Demo
                            </button>
                        )}
                        {hasExistingDemoData && (
                            <button
                                onClick={handleClearData}
                                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-xl font-medium hover:bg-red-200 transition-colors"
                            >
                                <Trash2 size={16} />
                                Limpiar
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
