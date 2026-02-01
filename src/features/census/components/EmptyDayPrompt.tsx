
import React, { useState } from 'react';
import { MONTH_NAMES } from '@/constants';
import { Copy, Calendar, Plus, ChevronDown, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

interface EmptyDayPromptProps {
    selectedDay: number;
    selectedMonth: number;
    previousRecordAvailable: boolean;
    previousRecordDate?: string; // YYYY-MM-DD format
    availableDates?: string[]; // All dates with records
    onCreateDay: (copyFromPrevious: boolean, specificDate?: string) => void;
    readOnly?: boolean;
}

export const EmptyDayPrompt: React.FC<EmptyDayPromptProps> = ({
    selectedDay,
    selectedMonth,
    previousRecordAvailable,
    previousRecordDate,
    availableDates = [],
    onCreateDay,
    readOnly = false
}) => {
    const [showDatePicker, setShowDatePicker] = useState(false);

    // Format date for display (DD de Mes)
    const formatDate = (dateStr: string) => {
        const [_year, month, day] = dateStr.split('-');
        const monthName = MONTH_NAMES[parseInt(month, 10) - 1];
        return `${parseInt(day, 10)} de ${monthName} `;
    };

    const handleSelectDate = (date: string) => {
        setShowDatePicker(false);
        onCreateDay(true, date);
    };

    return (
        <div className="card flex flex-col items-center justify-center py-16 mt-8 print:hidden animate-fade-in overflow-visible">
            <div className="bg-slate-50 p-6 rounded-full mb-6">
                <Calendar size={64} className="text-medical-200" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">
                {selectedDay} de {MONTH_NAMES[selectedMonth]}
            </h2>
            <p className="text-slate-500 mb-8 text-center max-w-md">
                No existe registro para esta fecha.
            </p>

            {!readOnly ? (
                <div className="flex flex-col sm:flex-row gap-4 flex-wrap justify-center">
                    {/* Copy from Previous Day Button with subtle date picker */}
                    {previousRecordAvailable && previousRecordDate && (
                        <div className="relative flex items-stretch">
                            {/* Main Copy Button */}
                            <button
                                onClick={() => onCreateDay(true, previousRecordDate)}
                                className="btn group !p-6 !h-auto border-2 border-slate-300 text-medical-700 hover:bg-medical-50 bg-white shadow-sm flex-col rounded-r-none border-r-0"
                                style={{ width: '230px' }}
                                data-testid="copy-previous-btn"
                            >
                                <div className="flex items-center gap-2 text-lg font-bold">
                                    <Copy size={20} />
                                    <span>Copiar del {formatDate(previousRecordDate)}</span>
                                </div>
                                <span className="text-xs font-normal text-medical-600/80">
                                    Incluye pacientes, camas y entregas de turno
                                </span>
                            </button>

                            {/* Subtle "+" expander for other dates */}
                            {availableDates.length > 1 && (
                                <>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowDatePicker(!showDatePicker); }}
                                        className={clsx(
                                            "border-2 border-slate-300 text-slate-400 hover:bg-slate-50 hover:text-slate-600 bg-white shadow-sm rounded-l-none px-2 transition-colors",
                                            showDatePicker && "bg-medical-50 text-medical-600"
                                        )}
                                        title="Seleccionar otra fecha"
                                        aria-label="Seleccionar otra fecha para copiar"
                                    >
                                        <ChevronDown size={16} className={clsx("transition-transform", showDatePicker && "rotate-180")} />
                                    </button>

                                    {/* Date Picker Dropdown - Opens Upward */}
                                    {showDatePicker && (
                                        <div className="absolute bottom-full right-0 mb-2 w-56 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl z-50 animate-fade-in">
                                            <div className="p-2">
                                                <p className="text-[10px] text-slate-400 uppercase font-bold px-2 py-1">Otras fechas</p>
                                                {availableDates
                                                    .filter(d => d !== previousRecordDate)
                                                    .map(date => (
                                                        <button
                                                            key={date}
                                                            onClick={() => handleSelectDate(date)}
                                                            className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-medical-50 hover:text-medical-700"
                                                        >
                                                            {formatDate(date)}
                                                        </button>
                                                    ))}
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* Blank Record Button */}
                    <button
                        onClick={() => onCreateDay(false)}
                        className="btn btn-primary group !p-6 !h-auto shadow-lg shadow-medical-500/30 flex-col w-64"
                        data-testid="blank-record-btn"
                    >
                        <div className="flex items-center gap-2 text-lg font-bold">
                            <Plus size={20} />
                            <span>Registro en Blanco</span>
                        </div>
                        <span className="text-xs font-normal text-medical-100">
                            Iniciar turno desde cero
                        </span>
                    </button>
                </div>
            ) : (
                <div className="bg-amber-50 border border-amber-200 p-6 rounded-2xl text-amber-800 flex flex-col items-center gap-2 max-w-sm text-center">
                    <ShieldCheck size={32} className="text-amber-500 mb-2" />
                    <p className="font-bold">Acceso de Invitado</p>
                    <p className="text-sm">No tienes permisos para iniciar nuevos registros. Por favor, contacta a una enfermera o administrador.</p>
                </div>
            )}
        </div >
    );
};
