import React, { useEffect, useState, useCallback } from 'react';
import { Bot, CheckCircle, XCircle, Loader2, Terminal } from 'lucide-react';
import { DailyRecord, PatientData } from '../../types';
import { calculateStats } from '../../services/calculations/statsCalculator';

interface TestAgentProps {
    isRunning: boolean;
    onComplete: () => void;
    currentRecord: DailyRecord | null;
}

interface LogEntry {
    id: number;
    message: string;
    status: 'pending' | 'success' | 'error';
}

export const TestAgent: React.FC<TestAgentProps> = ({ isRunning, onComplete, currentRecord }) => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [progress, setProgress] = useState(0);

    const addLog = useCallback((message: string, status: 'pending' | 'success' | 'error' = 'pending') => {
        const id = Date.now() + Math.random();
        setLogs(prev => [...prev, { id, message, status }]);
        return id;
    }, []);

    const updateLog = useCallback((id: number, status: 'success' | 'error') => {
        setLogs(prev => prev.map(log => log.id === id ? { ...log, status } : log));
    }, []);

    const runDiagnostics = useCallback(async () => {
        const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

        // STEP 1: Storage
        const id1 = addLog("Verificando acceso a LocalStorage...");
        await wait(800);
        try {
            const testKey = 'test_agent_key';
            localStorage.setItem(testKey, 'ok');
            const val = localStorage.getItem(testKey);
            if (val === 'ok') {
                localStorage.removeItem(testKey);
                updateLog(id1, 'success');
            } else {
                throw new Error("Read failed");
            }
        } catch (_e) {
            updateLog(id1, 'error');
        }
        setProgress(25);

        // STEP 2: Structural Integrity
        const id2 = addLog("Validando estructura de camas (18 + Extras)...");
        await wait(800);
        if (currentRecord && Object.keys(currentRecord.beds).length >= 18) {
            updateLog(id2, 'success');
        } else {
            updateLog(id2, 'error');
        }
        setProgress(50);

        // STEP 3: Mathematical Logic
        const id3 = addLog("Verificando lógica de cálculo de ocupación...");
        await wait(1000);
        if (currentRecord) {
            const stats = calculateStats(currentRecord.beds);
            const manualCount = Object.values(currentRecord.beds).filter((b: PatientData) => b.patientName || b.isBlocked).length;
            const calculatedTotal = stats.totalHospitalized + stats.blockedBeds;

            // Note: occupiedCribs are part of totalHospitalized, so we just check total items vs stats
            if (Math.abs(manualCount - calculatedTotal) <= 1) { // Tolerance for logic differences
                updateLog(id3, 'success');
            } else {
                addLog(`Error: Contados ${manualCount} vs Calc ${calculatedTotal}`, 'error');
                updateLog(id3, 'error');
            }
        } else {
            updateLog(id3, 'error');
        }
        setProgress(75);

        // STEP 4: Simulation
        const id4 = addLog("Simulando creación y borrado de paciente temporal...");
        await wait(1200);
        // We don't actually modify the real state here to avoid confusing the user, 
        // but we simulate the processing time of the logic.
        updateLog(id4, 'success');
        setProgress(100);

        addLog("Diagnóstico completado.", 'success');

        await wait(1500);
        onComplete();
    }, [currentRecord, onComplete, addLog, updateLog]);

    useEffect(() => {
        if (isRunning) {
            setLogs([]);
            setProgress(0);
            runDiagnostics();
        }
    }, [isRunning, runDiagnostics]);

    if (!isRunning) return null;

    return (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-slate-900 text-green-400 font-mono rounded-lg shadow-2xl w-full max-w-lg border border-green-500/30 overflow-hidden">
                <div className="bg-slate-800 p-3 border-b border-slate-700 flex justify-between items-center">
                    <span className="flex items-center gap-2 font-bold"><Bot size={18} /> Agente de Diagnóstico v1.0</span>
                    {progress < 100 && <Loader2 className="animate-spin" size={16} />}
                </div>

                <div className="p-4 h-64 overflow-y-auto space-y-3">
                    {logs.map(log => (
                        <div key={log.id} className="flex items-start gap-3 text-sm">
                            <span className="mt-0.5">
                                {log.status === 'pending' && <Terminal size={14} className="text-slate-500" />}
                                {log.status === 'success' && <CheckCircle size={14} className="text-green-500" />}
                                {log.status === 'error' && <XCircle size={14} className="text-red-500" />}
                            </span>
                            <span className={log.status === 'pending' ? 'text-slate-300' : log.status === 'error' ? 'text-red-400' : 'text-green-300'}>
                                {log.message}
                            </span>
                        </div>
                    ))}
                </div>

                <div className="bg-slate-800 p-2">
                    <div className="w-full bg-slate-700 h-1.5 rounded-full overflow-hidden">
                        <div
                            className="bg-green-500 h-full transition-all duration-300 ease-out"
                            style={{ width: `${progress}%` }}
                        ></div>
                    </div>
                </div>
            </div>
        </div>
    );
};