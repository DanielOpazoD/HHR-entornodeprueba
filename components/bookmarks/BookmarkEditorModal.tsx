import React, { useState, useEffect } from 'react';
import { Bookmark, BookmarkInput } from '@/types/bookmarks';
import { BaseModal } from '../shared/BaseModal';
import { Bookmark as BookmarkIcon } from 'lucide-react';

interface BookmarkEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (input: BookmarkInput) => Promise<void>;
    initialData?: Bookmark;
}

const COMMON_EMOJIS = ['🔗', '🏥', '📋', '💉', '🧪', '🩸', '💊', '🩺', '💾', '📁', '🏠', '📞', '📧', '⚙️', '📊', '🌐'];

export const BookmarkEditorModal: React.FC<BookmarkEditorModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialData
}) => {
    const [name, setName] = useState('');
    const [url, setUrl] = useState('');
    const [icon, setIcon] = useState('🔗');
    const [notes, setNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (initialData) {
                setName(initialData.name);
                setUrl(initialData.url);
                setIcon(initialData.icon || '🔗');
                setNotes(initialData.notes || '');
            } else {
                setName('');
                setUrl('');
                setIcon('🔗');
                setNotes('');
            }
        }
    }, [isOpen, initialData]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        try {
            await onSave({
                name,
                url: url.startsWith('http') ? url : `https://${url}`,
                icon,
                notes
            });
            onClose();
        } catch (error) {
            console.error('Error saving bookmark:', error);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title={initialData ? "Editar Marcador" : "Nuevo Marcador"}
            icon={<BookmarkIcon size={14} className="text-slate-400" />}
            variant="white"
            size="sm"
            className="!rounded-lg border-slate-100 shadow-xl"
            showCloseButton={true}
        >
            <form onSubmit={handleSubmit} className="space-y-4 -mt-2">
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Nombre del Sistema</label>
                        <input
                            autoFocus
                            required
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ej: Fonasa"
                            className="w-full px-0 py-1 bg-white border-0 border-b border-slate-100 focus:border-medical-500 transition-all outline-none text-xs placeholder:text-slate-200"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Icono</label>
                        <select
                            value={icon}
                            onChange={(e) => setIcon(e.target.value)}
                            className="w-full px-0 py-1 bg-white border-0 border-b border-slate-100 focus:border-medical-500 outline-none text-xs cursor-pointer"
                        >
                            {COMMON_EMOJIS.map(e => <option key={e} value={e}>{e}</option>)}
                        </select>
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">URL / Enlace</label>
                    <input
                        required
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="ejemplo.cl"
                        className="w-full px-0 py-1 bg-white border-0 border-b border-slate-100 focus:border-medical-500 transition-all outline-none text-xs placeholder:text-slate-200"
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Notas o Credenciales</label>
                    <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Usuario, clave o recordatorios..."
                        rows={1}
                        className="w-full px-0 py-1 bg-white border-0 border-b border-slate-100 focus:border-medical-500 transition-all outline-none resize-none text-xs placeholder:text-slate-200"
                    />
                </div>

                <div className="pt-4 flex gap-4">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-4 py-2 text-slate-300 text-[10px] font-bold hover:text-slate-500 transition-colors uppercase tracking-widest"
                    >
                        Cerrar
                    </button>
                    <button
                        type="submit"
                        disabled={isSaving}
                        className="flex-1 px-4 py-2 bg-slate-900 text-white text-[10px] font-bold rounded-sm hover:bg-black disabled:opacity-50 transition-all uppercase tracking-widest"
                    >
                        {isSaving ? '...' : (initialData ? 'Guardar' : 'Crear')}
                    </button>
                </div>
            </form>
        </BaseModal>
    );
};
