import React, { useState, useEffect, useCallback } from 'react';
import { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';
import { Search, UploadCloud, AlertTriangle } from 'lucide-react';
import { PatientMasterRepository } from '@/services/repositories/PatientMasterRepository';
import { MasterPatient } from '@/types';
import { usePatientAnalysis } from '@/hooks/usePatientAnalysis';
import { PatientExplorer } from './PatientExplorer';
import { SyncPanel } from './SyncPanel';
import { ConflictPanel } from './ConflictPanel';
import { PatientDetailModal } from './PatientDetailModal';
import clsx from 'clsx';

export const PatientDatabaseManager: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'EXPLORER' | 'SYNC' | 'CONFLICTS'>('EXPLORER');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPatient, setSelectedPatient] = useState<MasterPatient | null>(null);
    const [masterIndex, setMasterIndex] = useState<MasterPatient[]>([]);
    const [isLoadingIndex, setIsLoadingIndex] = useState(false);
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
    const [hasMore, setHasMore] = useState(true);

    const {
        isAnalyzing,
        isMigrating,
        isHarmonizing,
        analysis,
        migrationResult,
        runAnalysis,
        runMigration,
        resolveConflict
    } = usePatientAnalysis();

    const fetchMasterIndex = useCallback(async (reset = false, docToStartAfter?: QueryDocumentSnapshot<DocumentData> | null) => {
        setIsLoadingIndex(true);
        try {
            const { patients, lastDoc: nextDoc } = await PatientMasterRepository.getPatientsPaginated(
                30,
                docToStartAfter || undefined
            );

            if (reset) {
                setMasterIndex(patients);
            } else {
                setMasterIndex(prev => {
                    const existingRuts = new Set(prev.map(p => p.rut));
                    const news = patients.filter(p => !existingRuts.has(p.rut));
                    return [...prev, ...news];
                });
            }

            setLastDoc(nextDoc);
            setHasMore(!!nextDoc);
        } catch (error) {
            console.error("Failed to fetch master index", error);
        } finally {
            setIsLoadingIndex(false);
        }
    }, []);

    const handleSearch = useCallback(async (term: string) => {
        setSearchTerm(term);
        if (term.length > 2) {
            setIsLoadingIndex(true);
            const results = await PatientMasterRepository.searchPatients(term);
            setMasterIndex(results);
            setHasMore(false);
            setIsLoadingIndex(false);
        } else if (term.length === 0) {
            fetchMasterIndex(true, null);
        }
    }, [fetchMasterIndex]);

    useEffect(() => {
        fetchMasterIndex(true, null);
    }, [fetchMasterIndex]);

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 self-start sm:self-center">
                    <button
                        onClick={() => setActiveTab('EXPLORER')}
                        className={clsx(
                            "px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                            activeTab === 'EXPLORER' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                    >
                        <Search size={14} /> Explorer
                    </button>
                    <button
                        onClick={() => setActiveTab('SYNC')}
                        className={clsx(
                            "px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                            activeTab === 'SYNC' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                    >
                        <UploadCloud size={14} /> Sincronización
                    </button>
                    <button
                        onClick={() => setActiveTab('CONFLICTS')}
                        className={clsx(
                            "px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2",
                            activeTab === 'CONFLICTS' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                    >
                        <AlertTriangle size={14} className={analysis?.conflicts && analysis.conflicts.length > 0 ? "text-amber-500" : ""} />
                        Conflictos {analysis?.conflicts && analysis.conflicts.length > 0 ? `(${analysis.conflicts.length})` : ''}
                    </button>
                </div>
            </div>

            <div className="p-6">
                {activeTab === 'EXPLORER' && (
                    <PatientExplorer
                        patients={masterIndex}
                        searchTerm={searchTerm}
                        setSearchTerm={handleSearch}
                        isLoading={isLoadingIndex}
                        onSelectPatient={setSelectedPatient}
                        hasMore={hasMore && !searchTerm}
                        onLoadMore={() => fetchMasterIndex(false, lastDoc)}
                    />
                )}

                {activeTab === 'SYNC' && (
                    <SyncPanel
                        analysis={analysis}
                        isAnalyzing={isAnalyzing}
                        isMigrating={isMigrating}
                        migrationResult={migrationResult}
                        onRunAnalysis={runAnalysis}
                        onRunMigration={runMigration}
                    />
                )}

                {activeTab === 'CONFLICTS' && (
                    <ConflictPanel
                        conflicts={analysis?.conflicts || []}
                        onResolve={resolveConflict}
                        isHarmonizing={isHarmonizing}
                    />
                )}
            </div>

            {selectedPatient && (
                <PatientDetailModal
                    patient={selectedPatient}
                    onClose={() => setSelectedPatient(null)}
                />
            )}
        </div>
    );
};
