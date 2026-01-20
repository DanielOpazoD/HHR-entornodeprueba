import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, UploadCloud, AlertTriangle, Search, Users, Clock, MapPin, Activity, ChevronRight, Info, Heart } from 'lucide-react';
import { DailyRecordRepository } from '@/services/repositories/DailyRecordRepository';
import { PatientMasterRepository } from '@/services/repositories/PatientMasterRepository';
import { MasterPatient, HospitalizationEvent } from '@/types';
import { formatRut, isValidRut } from '@/utils/rutUtils';
import { formatDateDDMMYYYY } from '@/utils/dateUtils';
import clsx from 'clsx';

export const PatientDatabaseManager: React.FC = () => {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isMigrating, setIsMigrating] = useState(false);
    const [isLoadingIndex, setIsLoadingIndex] = useState(false);
    const [analysis, setAnalysis] = useState<{
        totalRecords: number; // Days scanned
        uniquePatients: number;
        validPatients: MasterPatient[];
        conflicts: Array<{
            rut: string;
            details: string;
            records: string[];
        }>;
    } | null>(null);
    const [migrationResult, setMigrationResult] = useState<{ successes: number, errors: number } | null>(null);
    const [masterIndex, setMasterIndex] = useState<MasterPatient[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedPatient, setSelectedPatient] = useState<MasterPatient | null>(null);
    const [activeTab, setActiveTab] = useState<'EXPLORER' | 'SYNC' | 'CONFLICTS'>('EXPLORER');

    const fetchMasterIndex = async () => {
        setIsLoadingIndex(true);
        try {
            const data = await PatientMasterRepository.getAllPatients();
            setMasterIndex(data);
        } catch (error) {
            console.error("Failed to fetch master index", error);
        } finally {
            setIsLoadingIndex(false);
        }
    };

    useEffect(() => {
        fetchMasterIndex();
    }, []);

    const runAnalysis = async () => {
        setIsAnalyzing(true);
        setAnalysis(null);
        setMigrationResult(null);

        try {
            const dates = await DailyRecordRepository.getAllDates();
            // Dates are usually descending, let's reverse to process chronologically for history building
            const sortedDates = [...dates].sort();

            const patientsMap = new Map<string, MasterPatient>();
            const conflicts: Array<{ rut: string; details: string; records: string[] }> = [];

            for (const date of sortedDates) {
                const record = await DailyRecordRepository.getForDate(date);
                if (!record) continue;

                // 1. Process active beds
                const allPatients = Object.values(record.beds);
                for (const p of allPatients) {
                    if (!p.rut || !isValidRut(p.rut) || !p.patientName) continue;

                    const normalizedRut = formatRut(p.rut).toUpperCase();
                    let master = patientsMap.get(normalizedRut);

                    if (!master) {
                        master = {
                            rut: normalizedRut,
                            fullName: p.patientName,
                            birthDate: p.birthDate,
                            forecast: p.insurance,
                            gender: p.biologicalSex,
                            hospitalizations: [],
                            vitalStatus: 'Vivo',
                            lastAdmission: p.admissionDate || record.date,
                            createdAt: Date.now(),
                            updatedAt: Date.now()
                        };
                        patientsMap.set(normalizedRut, master);
                    }

                    // Conflict check (Names)
                    if (master.fullName !== p.patientName) {
                        const existingConflict = conflicts.find(c => c.rut === normalizedRut);
                        if (!existingConflict) {
                            conflicts.push({
                                rut: normalizedRut,
                                details: `Diferencia de nombres: "${master.fullName}" vs "${p.patientName}"`,
                                records: [date]
                            });
                        } else if (!existingConflict.records.includes(date)) {
                            existingConflict.records.push(date);
                        }
                    }

                    // Event check (New Admission in history)
                    if (p.admissionDate) {
                        const alreadyRecorded = master.hospitalizations?.some(h =>
                            h.date === p.admissionDate && h.type === 'Ingreso'
                        );
                        if (!alreadyRecorded) {
                            master.hospitalizations?.push({
                                id: `${date}-ingreso`,
                                type: 'Ingreso',
                                date: p.admissionDate,
                                diagnosis: p.pathology || 'Sin diagnóstico',
                                bedName: p.bedId
                            });
                            master.lastAdmission = p.admissionDate;
                        }
                    }
                }

                // 2. Process discharges
                for (const d of record.discharges || []) {
                    if (!d.rut || !isValidRut(d.rut)) continue;
                    const normalizedRut = formatRut(d.rut).toUpperCase();
                    const master = patientsMap.get(normalizedRut);
                    if (master) {
                        const eventId = `${date}-egreso`;
                        if (!master.hospitalizations?.some(h => h.id === eventId)) {
                            master.hospitalizations?.push({
                                id: eventId,
                                type: 'Egreso',
                                date: record.date,
                                diagnosis: d.diagnosis || 'S/D',
                                bedName: d.bedName
                            });
                            master.lastDischarge = record.date;
                            if (d.status === 'Fallecido') {
                                master.vitalStatus = 'Fallecido';
                                master.hospitalizations?.push({
                                    id: `${date}-defuncion`,
                                    type: 'Fallecimiento',
                                    date: record.date,
                                    diagnosis: d.diagnosis
                                });
                            }
                        }
                    }
                }

                // 3. Process transfers
                for (const t of record.transfers || []) {
                    if (!t.rut || !isValidRut(t.rut)) continue;
                    const normalizedRut = formatRut(t.rut).toUpperCase();
                    const master = patientsMap.get(normalizedRut);
                    if (master) {
                        const eventId = `${date}-traslado`;
                        if (!master.hospitalizations?.some(h => h.id === eventId)) {
                            master.hospitalizations?.push({
                                id: eventId,
                                type: 'Traslado',
                                date: record.date,
                                diagnosis: t.diagnosis || 'S/D',
                                bedName: t.bedName,
                                receivingCenter: t.receivingCenter,
                                isEvacuation: t.evacuationMethod !== 'Manual'
                            });
                        }
                    }
                }
            }

            setAnalysis({
                totalRecords: dates.length,
                uniquePatients: patientsMap.size,
                validPatients: Array.from(patientsMap.values()),
                conflicts: conflicts
            });

        } catch (error) {
            console.error("Analysis failed", error);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const runMigration = async () => {
        if (!analysis || analysis.validPatients.length === 0) return;

        setIsMigrating(true);
        try {
            const { successes, errors } = await PatientMasterRepository.bulkUpsertPatients(analysis.validPatients);
            setMigrationResult({ successes, errors });
        } catch (error) {
            console.error("Migration failed", error);
        } finally {
            setIsMigrating(false);
        }
    };

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
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 p-2 rounded-xl">
                            <Search size={18} className="text-slate-400 ml-2" />
                            <input
                                type="text"
                                placeholder="Buscar por Nombre o RUT..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="bg-transparent border-none focus:ring-0 text-sm font-medium w-full placeholder:text-slate-400"
                            />
                            {isLoadingIndex && <RefreshCw className="animate-spin text-blue-500 mr-2" size={16} />}
                        </div>

                        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Paciente</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-widest text-[9px]">RUT</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Últ. Movimiento</th>
                                        <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Estado</th>
                                        <th className="px-3 py-2 text-right"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {(activeTab === 'EXPLORER' ? masterIndex : analysis?.validPatients || [])
                                        .filter(p => !searchTerm || p.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || p.rut.includes(searchTerm))
                                        .slice(0, 150)
                                        .map((p: MasterPatient) => (
                                            <tr key={p.rut} className="hover:bg-blue-50/40 transition-colors border-b border-slate-50 last:border-0 group">
                                                <td className="px-3 py-1.5">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-[10px] shadow-sm shrink-0">
                                                            {p.fullName.charAt(0)}
                                                        </div>
                                                        <div className="font-bold text-slate-700 text-xs truncate max-w-[200px]">{p.fullName}</div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">
                                                    {p.rut}
                                                </td>
                                                <td className="px-3 py-1.5">
                                                    <div className="flex flex-col gap-0.5">
                                                        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 font-medium">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                                            <span>Ing: {formatDateDDMMYYYY(p.lastAdmission)}</span>
                                                        </div>
                                                        {p.lastDischarge && (
                                                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                                <span>Egr: {formatDateDDMMYYYY(p.lastDischarge)}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-1.5">
                                                    <span className={clsx(
                                                        "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tight",
                                                        p.vitalStatus === 'Fallecido'
                                                            ? "bg-slate-100 text-slate-600"
                                                            : "bg-emerald-100 text-emerald-700"
                                                    )}>
                                                        {p.vitalStatus || 'Vivo'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-1.5 text-right">
                                                    <button
                                                        onClick={() => setSelectedPatient(p)}
                                                        className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-white rounded-lg transition-all"
                                                    >
                                                        <ChevronRight size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                            {masterIndex.length === 0 && !isLoadingIndex && (
                                <div className="p-8 text-center bg-slate-50/50">
                                    <Users size={32} className="mx-auto text-slate-300 mb-2" />
                                    <p className="text-sm text-slate-500 font-medium">No hay pacientes sincronizados en la base maestra.</p>
                                    <p className="text-xs text-slate-400">Ve a la pestaña de Sincronización para analizar el historial.</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'SYNC' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="p-2.5 bg-white rounded-xl shadow-sm border border-slate-200 text-slate-600">
                                    <Activity size={20} />
                                </div>
                                <h3 className="font-bold text-slate-800 tracking-tight text-base">Análisis de Historial</h3>
                            </div>

                            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
                                Escanea todos los registros diarios para reconstruir el historial clínico de cada paciente detectado.
                            </p>

                            {!analysis ? (
                                <button
                                    onClick={runAnalysis}
                                    disabled={isAnalyzing}
                                    className="w-full py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-sm transition-all flex items-center justify-center disabled:opacity-50 shadow-sm"
                                >
                                    {isAnalyzing ? (
                                        <RefreshCw className="mr-2 h-4 w-4 animate-spin text-blue-500" />
                                    ) : (
                                        <RefreshCw className="mr-2 h-4 w-4" />
                                    )}
                                    {isAnalyzing ? 'Analizando...' : 'Iniciar Análisis Retroactivo'}
                                </button>
                            ) : (
                                <div className="space-y-4 flex-1">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="bg-white p-3 rounded-xl border border-slate-200">
                                            <div className="text-[10px] text-slate-400 uppercase font-black mb-1">Días</div>
                                            <div className="text-xl font-black text-slate-800">{analysis.totalRecords}</div>
                                        </div>
                                        <div className="bg-white p-3 rounded-xl border border-slate-200">
                                            <div className="text-[10px] text-slate-400 uppercase font-black mb-1">Pacientes</div>
                                            <div className="text-xl font-black text-blue-600">{analysis.uniquePatients}</div>
                                        </div>
                                    </div>
                                    <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex justify-between items-center">
                                        <span className="text-xs font-bold text-amber-800">Conflictos detectados:</span>
                                        <span className="font-black text-amber-600 bg-white px-2 py-0.5 rounded-lg text-sm border border-amber-200">
                                            {analysis.conflicts.length}
                                        </span>
                                    </div>
                                    <button
                                        onClick={runAnalysis}
                                        className="w-full text-xs text-slate-400 hover:text-blue-500 font-bold underline transition-colors"
                                    >
                                        Repetir Análisis
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="p-5 bg-blue-600 rounded-2xl text-white shadow-xl shadow-blue-100 flex flex-col relative overflow-hidden">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl" />

                            <div className="flex items-center gap-3 mb-4 relative z-10">
                                <div className="p-2.5 bg-white/10 backdrop-blur-md rounded-xl border border-white/20 text-white">
                                    <UploadCloud size={20} />
                                </div>
                                <h3 className="font-bold tracking-tight text-base">Persistencia en Cloud</h3>
                            </div>

                            <p className="text-xs text-blue-100 mb-6 leading-relaxed relative z-10">
                                Sincroniza los resultados del análisis con la base maestra global. Esto habilitará el autocompletado inteligente.
                            </p>

                            <button
                                onClick={runMigration}
                                disabled={!analysis || isMigrating || analysis.uniquePatients === 0}
                                className="w-full py-4 bg-white text-blue-600 font-black rounded-xl shadow-lg border-b-4 border-blue-100 hover:bg-blue-50 hover:translate-y-[-2px] active:translate-y-[1px] transition-all disabled:opacity-50 disabled:translate-y-0 relative z-10"
                            >
                                {isMigrating ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <RefreshCw className="animate-spin" size={20} /> Actualizando persistencia...
                                    </span>
                                ) : (
                                    <span className="flex items-center justify-center gap-2 uppercase tracking-tight">
                                        Sincronizar Maestro {analysis?.uniquePatients ? `(${analysis.uniquePatients})` : ''}
                                    </span>
                                )}
                            </button>

                            {migrationResult && (
                                <div className="mt-4 p-3 bg-blue-500/30 backdrop-blur rounded-xl border border-white/10 text-xs animate-in slide-in-from-bottom-2">
                                    <div className="flex items-center gap-2 font-bold mb-1">
                                        <CheckCircle size={14} /> Sincronización Exitosa
                                    </div>
                                    <p className="text-blue-50 text-[10px]">
                                        {migrationResult.successes} pacientes actualizados.
                                        {migrationResult.errors > 0 && ` Detectados ${migrationResult.errors} errores.`}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'CONFLICTS' && (
                    <div className="space-y-4">
                        {!analysis || analysis.conflicts.length === 0 ? (
                            <div className="p-12 text-center bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
                                <CheckCircle size={48} className="mx-auto text-emerald-400 mb-4" />
                                <h3 className="text-lg font-bold text-slate-800 mb-1">Sin Conflictos</h3>
                                <p className="text-sm text-slate-500">No se detectaron inconsistencias de datos en el historial analizado.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl text-amber-800">
                                    <Info size={16} />
                                    <span className="text-xs font-bold">Inconsistencias de Identidad (Diferentes nombres para un mismo RUT)</span>
                                </div>
                                {analysis.conflicts.map((c: any, i: number) => (
                                    <div key={i} className="p-4 bg-white border border-slate-200 rounded-xl hover:border-amber-300 transition-colors">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="font-black text-slate-800 text-sm font-mono tracking-tight">{c.rut}</div>
                                            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-black">{c.records.length} Ocurrencias</span>
                                        </div>
                                        <p className="text-xs text-slate-600 mb-3 bg-slate-50 p-2 rounded-lg border-l-4 border-amber-400 font-medium">
                                            {c.details}
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {c.records.map((r: string) => (
                                                <span key={r} className="text-[9px] font-bold text-slate-400 px-2 py-0.5 bg-slate-100 rounded-md">
                                                    {r}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {selectedPatient && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                        <div className="p-6 bg-[#0B1120] text-white relative">
                            <button
                                onClick={() => setSelectedPatient(null)}
                                className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors z-20"
                            >
                                <ChevronRight className="rotate-90 md:rotate-0" size={20} />
                            </button>

                            <div className="flex items-center gap-5 relative z-10">
                                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-3xl font-black shadow-lg shadow-blue-900/40">
                                    {selectedPatient.fullName.charAt(0)}
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h2 className="text-2xl font-black leading-tight tracking-tight">{selectedPatient.fullName}</h2>
                                        <div className="px-2 py-0.5 bg-blue-500/20 border border-blue-500/30 rounded text-[10px] font-black text-blue-400 uppercase tracking-widest">
                                            {selectedPatient.hospitalizations?.length || 0} Eventos
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-slate-400 text-[11px] font-bold">
                                        <span className="font-mono bg-white/5 px-2 py-0.5 rounded text-white italic">{selectedPatient.rut}</span>
                                        <span className="flex items-center gap-1">
                                            <Heart size={14} className={selectedPatient.vitalStatus === 'Fallecido' ? "text-slate-500" : "text-emerald-400 shadow-emerald-400/50 drop-shadow-sm"} />
                                            {selectedPatient.vitalStatus || 'Vivo'}
                                        </span>
                                        <span className="flex items-center gap-1 uppercase tracking-widest">
                                            <MapPin size={12} className="text-blue-400" /> {selectedPatient.forecast || 'SIN PREVISIÓN'}
                                        </span>
                                        {selectedPatient.gender && (
                                            <span className="flex items-center gap-1 uppercase tracking-widest">
                                                <Activity size={12} className="text-indigo-400" /> {selectedPatient.gender}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] mb-6 flex items-center gap-2">
                                <Activity size={14} className="text-blue-500" /> Línea de Tiempo Clínica
                            </h3>

                            <div className="relative space-y-4">
                                <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-slate-200/60" />

                                {!selectedPatient.hospitalizations || selectedPatient.hospitalizations.length === 0 ? (
                                    <div className="text-center py-12 text-slate-400">
                                        <Clock size={32} className="mx-auto mb-2 opacity-30" />
                                        <p className="text-xs font-bold uppercase tracking-widest">Sin registros históricos</p>
                                    </div>
                                ) : (
                                    selectedPatient.hospitalizations
                                        .sort((a, b) => b.date.localeCompare(a.date))
                                        .map((ev: HospitalizationEvent, idx: number) => (
                                            <div key={idx} className="relative pl-8">
                                                <div className={clsx(
                                                    "absolute left-0 top-1.5 w-6 h-6 rounded-lg flex items-center justify-center border-2 border-white shadow-sm z-10",
                                                    ev.type === 'Ingreso' ? "bg-blue-600 text-white" :
                                                        ev.type === 'Egreso' ? "bg-emerald-500 text-white" :
                                                            ev.type === 'Traslado' ? "bg-amber-500 text-white" :
                                                                "bg-slate-800 text-white"
                                                )}>
                                                    {ev.type === 'Ingreso' && <UploadCloud size={12} className="rotate-180" />}
                                                    {ev.type === 'Egreso' && <CheckCircle size={12} />}
                                                    {ev.type === 'Traslado' && <Activity size={12} />}
                                                    {ev.type === 'Fallecimiento' && <Heart size={12} />}
                                                </div>

                                                <div className="bg-white p-3 rounded-xl border border-slate-200/60 shadow-sm transition-all hover:border-blue-200">
                                                    <div className="flex items-center justify-between gap-2 mb-2">
                                                        <span className="text-xs font-black text-slate-800 uppercase tracking-tight">{ev.type}</span>
                                                        <span className="text-[9px] font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 flex items-center gap-1.5">
                                                            <Clock size={10} /> {formatDateDDMMYYYY(ev.date)}
                                                        </span>
                                                    </div>

                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                                                        <div className="space-y-1">
                                                            <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Diagnóstico</div>
                                                            <div className="text-[11px] text-slate-600 font-bold leading-snug line-clamp-2">{ev.diagnosis}</div>
                                                        </div>

                                                        <div className="flex flex-wrap items-end justify-end gap-1.5">
                                                            {ev.bedName && (
                                                                <div className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-black border border-slate-200">
                                                                    CAMA: {ev.bedName}
                                                                </div>
                                                            )}
                                                            {ev.receivingCenter && (
                                                                <div className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px] font-black border border-amber-100">
                                                                    DESTINO: {ev.receivingCenter}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                )}
                            </div>
                        </div>

                        <div className="p-4 bg-white border-t border-slate-100 flex justify-end">
                            <button
                                onClick={() => setSelectedPatient(null)}
                                className="px-6 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-sm transition-all hover:bg-slate-800 active:scale-95 shadow-lg shadow-slate-200"
                            >
                                Cerrar Explorer
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
