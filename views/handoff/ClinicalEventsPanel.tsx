/**
 * ClinicalEventsPanel - Collapsible panel for clinical events (procedures, surgeries, cultures)
 * Used in nursing handoff view, within the diagnosis cell
 */
import React, { useState, useCallback } from 'react';
import { ClinicalEvent } from '@/types/core';
import { Plus, Pencil, Trash2, Check, X, Calendar, FileText } from 'lucide-react';
import clsx from 'clsx';

interface ClinicalEventsPanelProps {
    events: ClinicalEvent[];
    onAdd: (event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => void;
    onUpdate: (id: string, event: Partial<ClinicalEvent>) => void;
    onDelete: (id: string) => void;
    readOnly?: boolean;
}

interface EventFormData {
    name: string;
    date: string;
    note: string;
}

const emptyForm: EventFormData = { name: '', date: '', note: '' };

export const ClinicalEventsPanel: React.FC<ClinicalEventsPanelProps> = ({
    events,
    onAdd,
    onUpdate,
    onDelete,
    readOnly = false
}) => {
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<EventFormData>(emptyForm);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];

    const handleStartAdd = useCallback(() => {
        setFormData({ name: '', date: today, note: '' });
        setIsAddingNew(true);
        setEditingId(null);
    }, [today]);

    const handleStartEdit = useCallback((event: ClinicalEvent) => {
        setFormData({ name: event.name, date: event.date, note: event.note || '' });
        setEditingId(event.id);
        setIsAddingNew(false);
    }, []);

    const handleCancel = useCallback(() => {
        setIsAddingNew(false);
        setEditingId(null);
        setFormData(emptyForm);
        setConfirmDeleteId(null);
    }, []);

    const handleSaveNew = useCallback(() => {
        if (!formData.name.trim() || !formData.date) return;
        onAdd({
            name: formData.name.trim(),
            date: formData.date,
            note: formData.note.trim() || undefined
        });
        handleCancel();
    }, [formData, onAdd, handleCancel]);

    const handleSaveEdit = useCallback(() => {
        if (!editingId || !formData.name.trim() || !formData.date) return;
        onUpdate(editingId, {
            name: formData.name.trim(),
            date: formData.date,
            note: formData.note.trim() || undefined
        });
        handleCancel();
    }, [editingId, formData, onUpdate, handleCancel]);

    const handleConfirmDelete = useCallback((id: string) => {
        onDelete(id);
        setConfirmDeleteId(null);
    }, [onDelete]);

    const formatDate = (dateStr: string) => {
        const [year, month, day] = dateStr.split('-');
        return `${day}-${month}-${year}`;
    };

    // Sort events by date (newest first)
    const sortedEvents = [...events].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return (
        <div className="mt-2 border-t border-slate-200 pt-2 print:hidden">
            {/* Events List */}
            {sortedEvents.length > 0 && (
                <div className="space-y-1.5 mb-2">
                    {sortedEvents.map(event => (
                        <div key={event.id} className="group">
                            {editingId === event.id ? (
                                // Edit Mode
                                <EventForm
                                    formData={formData}
                                    onChange={setFormData}
                                    onSave={handleSaveEdit}
                                    onCancel={handleCancel}
                                    onDelete={() => {
                                        setConfirmDeleteId(event.id);
                                        setEditingId(null);
                                    }}
                                />
                            ) : confirmDeleteId === event.id ? (
                                // Delete Confirmation
                                <div className="flex items-center justify-between bg-red-50 p-2 rounded border border-red-200">
                                    <span className="text-xs text-red-700">¿Eliminar este evento?</span>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => handleConfirmDelete(event.id)}
                                            className="p-1 bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                                            title="Confirmar"
                                        >
                                            <Check size={12} />
                                        </button>
                                        <button
                                            onClick={() => setConfirmDeleteId(null)}
                                            className="p-1 bg-slate-400 text-white rounded hover:bg-slate-500 transition-colors"
                                            title="Cancelar"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                // View Mode
                                <div className="group relative bg-slate-50 px-2 py-1.5 rounded border border-slate-200 hover:border-slate-300 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-1">
                                            <div className="font-medium text-slate-700 text-xs break-words leading-snug flex-1">
                                                {event.name}
                                            </div>
                                            {!readOnly && (
                                                <button
                                                    onClick={() => handleStartEdit(event)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-500 p-0.5 shrink-0"
                                                    title="Editar evento"
                                                >
                                                    <Pencil size={10} />
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className="text-[9px] text-slate-400 font-normal whitespace-nowrap">
                                                ({formatDate(event.date)})
                                            </span>
                                        </div>
                                        {event.note && (
                                            <div className="text-[10px] text-slate-500 mt-1 italic break-words line-clamp-2 leading-tight border-t border-slate-100 pt-1" title={event.note}>
                                                {event.note}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Add New Form */}
            {isAddingNew ? (
                <EventForm
                    formData={formData}
                    onChange={setFormData}
                    onSave={handleSaveNew}
                    onCancel={handleCancel}
                />
            ) : !readOnly && (
                <button
                    onClick={handleStartAdd}
                    className="flex items-center gap-1 text-slate-400 hover:text-medical-600 transition-colors py-1 px-1"
                    title="Agregar evento"
                >
                    <Plus size={12} />
                </button>
            )}

            {/* Empty State */}
            {events.length === 0 && !isAddingNew && readOnly && (
                <div className="text-xs text-slate-400 italic">Sin eventos clínicos</div>
            )}
        </div>
    );
};

// ============================================================================
// Event Form Sub-component
// ============================================================================

interface EventFormProps {
    formData: EventFormData;
    onChange: (data: EventFormData) => void;
    onSave: () => void;
    onCancel: () => void;
    onDelete?: () => void;
}

const EventForm: React.FC<EventFormProps> = ({ formData, onChange, onSave, onCancel, onDelete }) => {
    const isValid = formData.name.trim() && formData.date;

    return (
        <div className="bg-blue-50 p-2 rounded border border-blue-200 space-y-2 shadow-sm animate-in fade-in zoom-in duration-200">
            <input
                type="text"
                value={formData.name}
                onChange={e => onChange({ ...formData, name: e.target.value })}
                placeholder="Nombre del evento"
                className="w-full px-2 py-1 text-xs border border-slate-300 rounded focus:ring-1 focus:ring-medical-500 focus:border-medical-500 bg-white"
                autoFocus
            />
            <div className="flex gap-1.5">
                <input
                    type="date"
                    value={formData.date}
                    onChange={e => onChange({ ...formData, date: e.target.value })}
                    className="w-24 shrink-0 px-1 py-1 text-[10px] border border-slate-300 rounded focus:ring-1 focus:ring-medical-500 focus:border-medical-500 bg-white"
                />
                <input
                    type="text"
                    value={formData.note}
                    onChange={e => onChange({ ...formData, note: e.target.value })}
                    placeholder="Nota (opcional)"
                    className="flex-1 px-2 py-1 text-[10px] border border-slate-300 rounded focus:ring-1 focus:ring-medical-500 focus:border-medical-500 bg-white"
                />
            </div>
            <div className="flex justify-between items-center pt-1 border-t border-blue-100">
                <div>
                    {onDelete && (
                        <button
                            onClick={onDelete}
                            className="p-1 px-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="Eliminar evento"
                        >
                            <Trash2 size={12} />
                        </button>
                    )}
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={onCancel}
                        className="px-2 py-1 text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={onSave}
                        disabled={!isValid}
                        className={clsx(
                            "px-2.5 py-1 text-[10px] rounded font-medium transition-colors",
                            isValid
                                ? "bg-medical-600 text-white hover:bg-medical-700 shadow-sm"
                                : "bg-slate-200 text-slate-400 cursor-not-allowed"
                        )}
                    >
                        Guardar
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ClinicalEventsPanel;
