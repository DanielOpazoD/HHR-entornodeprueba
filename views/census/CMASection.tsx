import React, { useState } from 'react';
import { CMAData } from '@/types';
import { useDailyRecordContext } from '@/context/DailyRecordContext';
import { Trash2, Save, X, Plus, Scissors } from 'lucide-react';
import { SPECIALTY_OPTIONS } from '@/constants';
import { DebouncedInput } from '@/components/ui/DebouncedInput';
import { PatientInputSchema } from '@/schemas/inputSchemas';
import clsx from 'clsx';

const INTERVENTION_TYPES = [
    'Cirugía Mayor Ambulatoria',
    'Procedimiento Médico Ambulatorio'
] as const;

// Camas disponibles para hospitalización diurna
const CMA_BEDS = [
    'R1', 'R2', 'R3', 'R4',
    'NEO 1', 'NEO 2',
    'H1C1', 'H1C2', 'H2C1', 'H2C2',
    'H3C1', 'H3C2', 'H4C1', 'H4C2',
    'H5C1', 'H5C2', 'H6C1', 'H6C2'
] as const;

export const CMASection: React.FC = () => {
    const { record, addCMA, deleteCMA, updateCMA } = useDailyRecordContext();
    const [isAdding, setIsAdding] = useState(false);

    // State for new entry
    const [newEntry, setNewEntry] = useState<Partial<CMAData>>({
        bedName: '',
        patientName: '',
        rut: '',
        age: '',
        diagnosis: '',
        specialty: '',
        interventionType: 'Cirugía Mayor Ambulatoria' // Default
    });

    if (!record) return null;

    const cmaList = record.cma || [];

    const handleAdd = () => {
        if (!newEntry.patientName) return;

        addCMA({
            bedName: newEntry.bedName || '',
            patientName: newEntry.patientName || '',
            rut: newEntry.rut || '',
            age: newEntry.age || '',
            diagnosis: newEntry.diagnosis || '',
            specialty: newEntry.specialty || '',
            interventionType: newEntry.interventionType || 'Cirugía Mayor Ambulatoria'
        });

        setNewEntry({
            bedName: '',
            patientName: '',
            rut: '',
            age: '',
            diagnosis: '',
            specialty: '',
            interventionType: 'Cirugía Mayor Ambulatoria'
        });
        setIsAdding(false);
    };

    const handleUpdate = (id: string, field: keyof CMAData, value: string) => {
        updateCMA(id, { [field]: value });
    };

    return (
        <div className="card mt-6 animate-fade-in print:break-inside-avoid">
            {/* Header minimalista */}
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-medical-50 text-medical-600 rounded-lg shadow-sm">
                        <Scissors size={18} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-800 leading-tight">
                            Hospitalización Diurna
                        </h2>
                        <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">CMA / PMA</p>
                    </div>
                </div>
                {!isAdding && (
                    <button
                        onClick={() => setIsAdding(true)}
                        className="flex items-center gap-1.5 text-slate-400 hover:text-medical-600 hover:bg-medical-50/50 px-2.5 py-1.5 rounded-lg transition-all text-xs font-semibold"
                    >
                        <Plus size={14} />
                        Agregar Paciente
                    </button>
                )}
            </div>

            {(!cmaList.length && !isAdding) ? (
                <div className="p-4 text-slate-400 italic text-sm">
                    No hay registros de Hospitalización Diurna para hoy.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50/50 text-slate-500 font-bold border-b border-slate-200 uppercase text-[10px] tracking-tight">
                            <tr>
                                <th className="px-3 py-2.5 w-24">Cama</th>
                                <th className="px-3 py-2.5 w-40">Tipo Intervención</th>
                                <th className="px-3 py-2.5 w-48">Paciente</th>
                                <th className="px-3 py-2.5 w-36">RUT / Identidad</th>
                                <th className="px-3 py-2.5 w-16 text-center">Edad</th>
                                <th className="px-3 py-2.5 min-w-[200px]">Diagnóstico Clínico</th>
                                <th className="px-3 py-2.5 w-44">Especialidad</th>
                                <th className="px-3 py-2.5 w-10 text-right"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {/* Existing Entries */}
                            {cmaList.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-50 group">
                                    <td className="p-2">
                                        <select
                                            className="w-full p-1 border border-transparent hover:border-slate-300 rounded focus:border-medical-400 focus:ring-2 focus:ring-medical-500/10 text-[11px] font-bold text-slate-700 bg-transparent transition-all outline-none"
                                            value={item.bedName}
                                            onChange={(e) => handleUpdate(item.id, 'bedName', e.target.value)}
                                        >
                                            <option value="">--</option>
                                            {CMA_BEDS.map(bed => (
                                                <option key={bed} value={bed}>{bed}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <select
                                            className="w-full p-1 border border-transparent hover:border-slate-300 rounded focus:border-orange-400 focus:ring-1 focus:ring-orange-400 text-[11px] bg-transparent transition-colors"
                                            value={item.interventionType || 'Cirugía Mayor Ambulatoria'}
                                            onChange={(e) => handleUpdate(item.id, 'interventionType', e.target.value)}
                                        >
                                            {INTERVENTION_TYPES.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2 font-medium">
                                        <DebouncedInput
                                            type="text"
                                            className={clsx(
                                                "w-full p-1 border rounded text-[11px] font-bold text-slate-700 transition-all focus:ring-2 outline-none",
                                                !PatientInputSchema.pick({ patientName: true }).safeParse({ patientName: item.patientName }).success && item.patientName
                                                    ? "border-red-300 bg-red-50/30 focus:border-red-500 focus:ring-red-400/20"
                                                    : "border-transparent hover:border-slate-300 focus:border-medical-400 focus:ring-medical-500/10"
                                            )}
                                            value={item.patientName}
                                            onChange={(val) => handleUpdate(item.id, 'patientName', val)}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <DebouncedInput
                                            type="text"
                                            className={clsx(
                                                "w-full p-1 border rounded text-xs transition-colors focus:ring-1",
                                                !PatientInputSchema.pick({ rut: true }).safeParse({ rut: item.rut }).success && item.rut
                                                    ? "border-red-400 focus:border-red-500 focus:ring-red-400"
                                                    : "border-transparent hover:border-slate-300 focus:border-orange-400 focus:ring-orange-400"
                                            )}
                                            value={item.rut}
                                            onChange={(val) => handleUpdate(item.id, 'rut', val)}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <DebouncedInput
                                            type="text"
                                            placeholder="Edad"
                                            className={clsx(
                                                "w-full p-1 border rounded text-xs text-center transition-colors focus:ring-1",
                                                !PatientInputSchema.pick({ age: true }).safeParse({ age: item.age }).success && item.age
                                                    ? "border-red-400 focus:border-red-500 focus:ring-red-400"
                                                    : "border-transparent hover:border-slate-300 focus:border-orange-400 focus:ring-orange-400"
                                            )}
                                            value={item.age}
                                            onChange={(val) => handleUpdate(item.id, 'age', val)}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <DebouncedInput
                                            type="text"
                                            className={clsx(
                                                "w-full p-1 border rounded text-xs transition-colors focus:ring-1",
                                                !PatientInputSchema.pick({ pathology: true }).safeParse({ pathology: item.diagnosis }).success && item.diagnosis
                                                    ? "border-red-400 focus:border-red-500 focus:ring-red-400"
                                                    : "border-transparent hover:border-slate-300 focus:border-orange-400 focus:ring-orange-400"
                                            )}
                                            value={item.diagnosis}
                                            onChange={(val) => handleUpdate(item.id, 'diagnosis', val)}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <select
                                            className="w-full p-1 border border-transparent hover:border-slate-300 rounded focus:border-medical-400 focus:ring-2 focus:ring-medical-500/10 text-xs bg-transparent transition-all outline-none"
                                            value={item.specialty}
                                            onChange={(e) => handleUpdate(item.id, 'specialty', e.target.value)}
                                        >
                                            <option value="">--</option>
                                            {SPECIALTY_OPTIONS.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2 text-right">
                                        <button
                                            onClick={() => deleteCMA(item.id)}
                                            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                            title="Eliminar registro"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}

                            {/* Add New Entry Row */}
                            {isAdding && (
                                <tr className="bg-medical-50/30 animate-scale-in">
                                    <td className="p-2">
                                        <select
                                            className="w-full p-1.5 border border-slate-200 rounded text-xs focus:outline-none focus:border-medical-400 focus:ring-2 focus:ring-medical-500/10 transition-all font-bold text-slate-700"
                                            value={newEntry.bedName || ''}
                                            onChange={(e) => setNewEntry({ ...newEntry, bedName: e.target.value })}
                                            autoFocus
                                        >
                                            <option value="">--</option>
                                            {CMA_BEDS.map(bed => (
                                                <option key={bed} value={bed}>{bed}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <select
                                            className="w-full p-1.5 border border-orange-200 rounded text-[11px] focus:outline-none focus:border-orange-400"
                                            value={newEntry.interventionType || 'Cirugía Mayor Ambulatoria'}
                                            onChange={(e) => setNewEntry({ ...newEntry, interventionType: e.target.value as any })}
                                        >
                                            {INTERVENTION_TYPES.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <input
                                            type="text"
                                            placeholder="Nombre Paciente"
                                            className={clsx(
                                                "w-full p-1.5 border rounded text-xs focus:outline-none transition-all font-bold",
                                                !PatientInputSchema.pick({ patientName: true }).safeParse({ patientName: newEntry.patientName }).success && newEntry.patientName
                                                    ? "border-red-400 focus:border-red-500 bg-red-50/20"
                                                    : "border-slate-200 focus:border-medical-400 focus:ring-2 focus:ring-medical-500/10"
                                            )}
                                            value={newEntry.patientName || ''}
                                            onChange={(e) => setNewEntry({ ...newEntry, patientName: e.target.value })}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <input
                                            type="text"
                                            placeholder="RUT"
                                            className={clsx(
                                                "w-full p-1.5 border rounded text-xs focus:outline-none transition-all",
                                                !PatientInputSchema.pick({ rut: true }).safeParse({ rut: newEntry.rut }).success && newEntry.rut
                                                    ? "border-red-400 focus:border-red-500"
                                                    : "border-orange-200 focus:border-orange-400"
                                            )}
                                            value={newEntry.rut || ''}
                                            onChange={(e) => setNewEntry({ ...newEntry, rut: e.target.value })}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <input
                                            type="text"
                                            placeholder="Edad"
                                            className={clsx(
                                                "w-full p-1.5 border rounded text-xs focus:outline-none focus:border-orange-400 text-center transition-all",
                                                !PatientInputSchema.pick({ age: true }).safeParse({ age: newEntry.age }).success && newEntry.age
                                                    ? "border-red-400 focus:border-red-500"
                                                    : "border-orange-200 focus:border-orange-400"
                                            )}
                                            value={newEntry.age || ''}
                                            onChange={(e) => setNewEntry({ ...newEntry, age: e.target.value })}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <input
                                            type="text"
                                            placeholder="Diagnóstico"
                                            className={clsx(
                                                "w-full p-1.5 border rounded text-xs focus:outline-none transition-all",
                                                !PatientInputSchema.pick({ pathology: true }).safeParse({ pathology: newEntry.diagnosis }).success && newEntry.diagnosis
                                                    ? "border-red-400 focus:border-red-500"
                                                    : "border-orange-200 focus:border-orange-400"
                                            )}
                                            value={newEntry.diagnosis || ''}
                                            onChange={(e) => setNewEntry({ ...newEntry, diagnosis: e.target.value })}
                                        />
                                    </td>
                                    <td className="p-2">
                                        <select
                                            className="w-full p-1.5 border border-orange-200 rounded text-xs focus:outline-none focus:border-orange-400"
                                            value={newEntry.specialty || ''}
                                            onChange={(e) => setNewEntry({ ...newEntry, specialty: e.target.value })}
                                        >
                                            <option value="">-- Sel --</option>
                                            {SPECIALTY_OPTIONS.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2 flex gap-1 justify-end">
                                        <button
                                            onClick={handleAdd}
                                            disabled={!newEntry.patientName}
                                            className="p-1.5 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50 transition-colors"
                                            title="Guardar"
                                        >
                                            <Save size={14} />
                                        </button>
                                        <button
                                            onClick={() => setIsAdding(false)}
                                            className="p-1.5 bg-slate-200 text-slate-600 rounded hover:bg-slate-300 transition-colors"
                                            title="Cancelar"
                                        >
                                            <X size={14} />
                                        </button>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
