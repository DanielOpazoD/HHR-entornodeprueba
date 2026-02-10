import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Phone, Calendar, Edit2, X, Save, Clock, Info, Stethoscope, Eye } from 'lucide-react';
import { OnDutyProfessional, OnDutySpecialty, ProfessionalCatalogItem } from '@/types';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { useAuthState } from '@/hooks/useAuthState';
import { useStaffContext } from '@/context/StaffContext';
import { useScrollLock } from '@/hooks/useScrollLock';
import { formatDateDDMMYYYY, getTodayISO } from '@/utils/dateUtils';

const SPECIALTIES: OnDutySpecialty[] = [
    'Medicina Interna',
    'Cirugía',
    'Ginecobstetricia',
    'Anestesia',
    'Kinesiología'
];

interface OnDutyProfessionalsCardProps {
    className?: string;
    readOnly?: boolean;
}

export const OnDutyProfessionalsCard: React.FC<OnDutyProfessionalsCardProps> = ({
    className = '',
    readOnly = false
}) => {
    const { record: dailyRecord } = useDailyRecordData();
    const { updateOnDutyProfessionalsFull } = useDailyRecordActions();
    const { role } = useAuthState();
    const { professionalsCatalog, setProfessionalsCatalog } = useStaffContext();
    const [isViewOpen, setIsViewOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    const isAdmin = role === 'admin' && !readOnly;
    const professionals = dailyRecord?.onDutyProfessionals || [];
    const coverageStart = dailyRecord?.onDutyCoverageStart;
    const coverageEnd = dailyRecord?.onDutyCoverageEnd;

    const [editData, setEditData] = useState<OnDutyProfessional[]>([]);
    const [editStart, setEditStart] = useState('');
    const [editEnd, setEditEnd] = useState('');
    const [rememberProfessionals, setRememberProfessionals] = useState(true);

    // Lock scroll when any modal is open
    useScrollLock(isViewOpen || isEditModalOpen);

    useEffect(() => {
        if (isEditModalOpen) {
            setEditData(professionals.length > 0 ? [...professionals] : []);
            setEditStart(coverageStart || getTodayISO());
            setEditEnd(coverageEnd || '');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEditModalOpen]);

    const getProfessionalData = (specialty: OnDutySpecialty, sourceData: OnDutyProfessional[] = professionals) => {
        return sourceData.find(p => p.specialty === specialty) || {
            specialty,
            name: '',
            phone: '',
            period: ''
        };
    };

    const handleSetWeeklyPeriod = (startDate: string) => {
        if (!startDate) return;
        const start = new Date(`${startDate}T08:00:00`);
        const end = new Date(start);
        end.setDate(start.getDate() + 7);
        setEditStart(startDate);
        setEditEnd(end.toISOString().split('T')[0]);
    };

    const handleSave = async () => {
        await updateOnDutyProfessionalsFull({
            professionals: editData,
            coverageStart: editStart,
            coverageEnd: editEnd
        });

        // Update catalog if "Remember" is checked
        if (rememberProfessionals) {
            const newCatalog = [...professionalsCatalog];
            editData.forEach(p => {
                if (!p.name) return;
                const existingIndex = newCatalog.findIndex(c => c.name.toLowerCase() === p.name.toLowerCase());
                const item: ProfessionalCatalogItem = {
                    name: p.name,
                    phone: p.phone,
                    specialty: p.specialty,
                    period: p.period,
                    lastUsed: new Date().toISOString()
                };
                if (existingIndex >= 0) {
                    newCatalog[existingIndex] = item;
                } else {
                    newCatalog.push(item);
                }
            });
            setProfessionalsCatalog(newCatalog);
        }

        setIsEditModalOpen(false);
    };

    const formatDate = (isoDate: string | undefined) => {
        if (!isoDate) return null;
        try {
            const date = new Date(isoDate);
            return date.toLocaleDateString('es-CL', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return null;
        }
    };

    const renderViewDialog = () => {
        if (!isViewOpen) return null;

        return createPortal(
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9000] animate-fade-in p-4">
                <div
                    className="bg-white rounded-xl shadow-2xl w-full max-w-[450px] animate-scale-in max-h-[90vh] flex flex-col overflow-hidden border border-slate-200"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-slate-50/50">
                        <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                            <div className="p-1.5 bg-medical-100 rounded-lg">
                                <Stethoscope size={18} className="text-medical-600" />
                            </div>
                            Profesionales de Turno
                        </h3>
                        <button
                            onClick={() => setIsViewOpen(false)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    {/* Professionals List */}
                    <div className="p-4 space-y-3 overflow-y-auto">
                        <div className="flex flex-col gap-1 items-center justify-center py-2 px-1 border-b border-slate-100 mb-2">
                            <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                                <Calendar size={12} /> Periodo de Cobertura
                            </span>
                            <span className="text-xs font-semibold text-medical-700 bg-medical-50 px-2 py-0.5 rounded-full">
                                {coverageStart ? (
                                    <>
                                        {formatDateDDMMYYYY(coverageStart)} 08:00 — {coverageEnd ? formatDateDDMMYYYY(coverageEnd) : '?'} 07:59
                                    </>
                                ) : 'No definido'}
                            </span>
                        </div>

                        {professionals.length > 0 ? (
                            SPECIALTIES.map((specialty) => {
                                const data = getProfessionalData(specialty);
                                const hasData = data.name || data.phone || data.period;

                                return (
                                    <div
                                        key={specialty}
                                        className={`p-3.5 rounded-xl border transition-all ${hasData
                                            ? 'border-medical-200 bg-medical-50/20'
                                            : 'border-slate-200 bg-slate-50/50'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between mb-2.5">
                                            <div className="flex items-center gap-2">
                                                <div className={`w-1.5 h-1.5 rounded-full ${hasData ? 'bg-medical-500' : 'bg-slate-300'}`} />
                                                <span className="text-xs font-bold text-slate-700 uppercase tracking-tight">{specialty}</span>
                                            </div>
                                        </div>

                                        {hasData ? (
                                            <div className="grid grid-cols-1 gap-2 pl-3.5 border-l-2 border-medical-100 ml-0.5">
                                                <div className="flex items-center gap-2.5 text-sm">
                                                    <span className="font-semibold text-slate-700">{data.name || 'Sin nombre'}</span>
                                                </div>
                                                <div className="flex items-center gap-4 text-xs text-slate-600">
                                                    <div className="flex items-center gap-1.5">
                                                        <Phone size={12} className="text-medical-400" />
                                                        <span>{data.phone || '-'}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <Clock size={12} className="text-medical-400" />
                                                        <span>{data.period || '-'}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-[11px] text-slate-400 italic pl-3.5">Información pendiente de registro</p>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-center py-8 text-slate-500 text-sm">
                                <Info size={20} className="mx-auto mb-2" />
                                <p>No hay profesionales de turno registrados.</p>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    {dailyRecord?.onDutyProfessionalsUpdatedAt && (
                        <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-center gap-1.5">
                            <Clock size={10} className="text-slate-400" />
                            <span className="text-[10px] text-slate-400 font-medium">
                                Última actualización: {formatDate(dailyRecord.onDutyProfessionalsUpdatedAt)}
                            </span>
                        </div>
                    )}

                    {isAdmin && (
                        <button
                            onClick={() => {
                                setIsViewOpen(false);
                                setIsEditModalOpen(true);
                            }}
                            className="w-full mt-4 flex items-center justify-center gap-2 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all font-bold text-sm shadow-md active:scale-[0.98]"
                        >
                            <Edit2 size={16} /> Gestionar Profesionales
                        </button>
                    )}
                </div>
            </div>,
            document.body
        );
    };

    const renderEditModal = () => {
        if (!isEditModalOpen) return null;

        const handleProfessionalChange = (specialty: OnDutySpecialty, field: keyof OnDutyProfessional, value: string) => {
            setEditData((prev: OnDutyProfessional[]) => {
                const existingIndex = prev.findIndex((p: OnDutyProfessional) => p.specialty === specialty);
                if (existingIndex >= 0) {
                    const newArr = [...prev];
                    newArr[existingIndex] = { ...newArr[existingIndex], [field]: value };
                    return newArr;
                } else {
                    return [...prev, { specialty, name: '', phone: '', period: '', [field]: value }];
                }
            });
        };

        const handleSelectProfessional = (specialty: OnDutySpecialty, catalogItem: ProfessionalCatalogItem) => {
            handleProfessionalChange(specialty, 'name', catalogItem.name);
            handleProfessionalChange(specialty, 'phone', catalogItem.phone);
            handleProfessionalChange(specialty, 'period', catalogItem.period || '');
        };

        const getFilteredCatalog = (specialty: OnDutySpecialty, currentName: string) => {
            return professionalsCatalog.filter((p: ProfessionalCatalogItem) =>
                p.specialty === specialty &&
                p.name.toLowerCase().includes(currentName.toLowerCase())
            );
        };

        return createPortal(
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000] animate-fade-in p-4">
                <div
                    className="bg-white rounded-xl shadow-2xl p-5 w-full max-w-[500px] animate-scale-in border border-slate-200 max-h-[90vh] flex flex-col"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <div className="p-1.5 bg-indigo-100 rounded-lg">
                                <Edit2 size={18} className="text-indigo-600" />
                            </div>
                            Gestionar Profesionales de Turno
                        </h3>
                        <button
                            onClick={() => setIsEditModalOpen(false)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex-grow overflow-y-auto pr-2 -mr-2">
                        {/* Coverage Period */}
                        <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-100">
                            <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                                <Calendar size={16} className="text-slate-500" /> Periodo de Cobertura
                            </h4>
                            <div className="grid grid-cols-2 gap-4 mb-3">
                                <div>
                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Inicio</label>
                                    <input
                                        type="date"
                                        value={editStart}
                                        onChange={(e) => setEditStart(e.target.value)}
                                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Fin</label>
                                    <input
                                        type="date"
                                        value={editEnd}
                                        onChange={(e) => setEditEnd(e.target.value)}
                                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                                    />
                                </div>
                            </div>
                            <button
                                onClick={() => handleSetWeeklyPeriod(editStart || getTodayISO())}
                                className="w-full px-4 py-2 text-xs font-bold bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-all uppercase tracking-wider flex items-center justify-center gap-2"
                            >
                                <Calendar size={14} /> Establecer 1 Semana (Lunes a Lunes)
                            </button>
                        </div>

                        {/* Professionals */}
                        <div className="space-y-5">
                            {SPECIALTIES.map((specialty) => {
                                const data = getProfessionalData(specialty, editData);
                                const filteredCatalog = getFilteredCatalog(specialty, data.name);

                                return (
                                    <div key={specialty} className="p-4 border border-slate-200 rounded-lg bg-white">
                                        <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                                            <Stethoscope size={16} className="text-medical-500" /> {specialty}
                                        </h4>
                                        <div className="space-y-3">
                                            <div className="relative">
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Nombre</label>
                                                <input
                                                    type="text"
                                                    value={data.name}
                                                    onChange={(e) => handleProfessionalChange(specialty, 'name', e.target.value)}
                                                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                                                    placeholder="Ej: Dr. Juan Pérez"
                                                />
                                                {data.name && filteredCatalog.length > 0 && (
                                                    <div className="absolute z-10 bg-white border border-slate-200 rounded-lg shadow-lg mt-1 w-full max-h-40 overflow-y-auto">
                                                        {filteredCatalog.map((item: ProfessionalCatalogItem, index: number) => (
                                                            <button
                                                                key={index}
                                                                onClick={() => handleSelectProfessional(specialty, item)}
                                                                className="flex items-center justify-between w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 transition-colors"
                                                            >
                                                                <span>{item.name}</span>
                                                                <span className="text-xs text-slate-500">{item.phone}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Teléfono</label>
                                                <div className="relative">
                                                    <Phone className="absolute left-3 top-2.5 text-slate-400" size={14} />
                                                    <input
                                                        type="tel"
                                                        value={data.phone}
                                                        onChange={(e) => handleProfessionalChange(specialty, 'phone', e.target.value)}
                                                        className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                                                        placeholder="+56 9 ..."
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Periodo</label>
                                                <div className="relative">
                                                    <Clock className="absolute left-3 top-2.5 text-slate-400" size={14} />
                                                    <input
                                                        type="text"
                                                        value={data.period}
                                                        onChange={(e) => handleProfessionalChange(specialty, 'period', e.target.value)}
                                                        className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 focus:outline-none transition-all"
                                                        placeholder="Ej: 08:00 - 20:00"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={rememberProfessionals}
                                onChange={(e) => setRememberProfessionals(e.target.checked)}
                                className="form-checkbox h-4 w-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                            />
                            Recordar profesionales para uso futuro
                        </label>
                        <div className="flex gap-2.5">
                            <button
                                onClick={() => setIsEditModalOpen(false)}
                                className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-all uppercase tracking-wider"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSave}
                                className="px-5 py-2 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all uppercase tracking-wider flex items-center gap-1.5"
                            >
                                <Save size={14} /> Guardar Cambios
                            </button>
                        </div>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    return (
        <>
            <div className={`card px-3 py-2 flex flex-col gap-1 hover:border-medical-200 hover:shadow-md transition-all cursor-default min-w-[130px] border-medical-50 bg-white ${className}`}>
                <div className="flex items-center justify-between mb-0.5 pb-1 border-b border-slate-50">
                    <div className="flex items-center gap-1.5">
                        <Stethoscope size={12} className="text-medical-500" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            Profesionales
                        </span>
                    </div>
                </div>

                <button
                    onClick={() => setIsViewOpen(true)}
                    className="flex items-center justify-center gap-2 mt-0.5 px-3 py-2 bg-medical-600 hover:bg-medical-700 text-white rounded-lg shadow-sm shadow-medical-100 transition-all active:scale-95"
                >
                    <Eye size={13} strokeWidth={3} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Ver Turnos</span>
                </button>

                {dailyRecord?.onDutyProfessionalsUpdatedAt && (
                    <div className="flex items-center justify-center gap-1 text-[8px] text-slate-400 mt-0.5 font-medium">
                        <Clock size={8} />
                        <span>Act: {formatDate(dailyRecord.onDutyProfessionalsUpdatedAt)}</span>
                    </div>
                )}
            </div>

            {renderViewDialog()}
            {renderEditModal()}
        </>
    );
};
