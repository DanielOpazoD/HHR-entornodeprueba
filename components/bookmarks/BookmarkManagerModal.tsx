import React, { useState, useEffect } from 'react';
import { Bookmark } from '@/types/bookmarks';
import { BaseModal } from '../shared/BaseModal';
import {
    ChevronUp,
    ChevronDown,
    Trash2,
    Edit2,
    GripVertical,
    Save
} from 'lucide-react';
import {
    reorderBookmarks,
    deleteBookmark
} from '@/services/bookmarks/bookmarkService';

interface BookmarkManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    bookmarks: Bookmark[];
    onEdit: (bookmark: Bookmark) => void;
}

export const BookmarkManagerModal: React.FC<BookmarkManagerModalProps> = ({
    isOpen,
    onClose,
    bookmarks: initialBookmarks,
    onEdit
}) => {
    const [localBookmarks, setLocalBookmarks] = useState<Bookmark[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setLocalBookmarks([...initialBookmarks]);
            setHasChanges(false);
        }
    }, [isOpen, initialBookmarks]);

    const handleMove = (index: number, direction: 'up' | 'down') => {
        const newBookmarks = [...localBookmarks];
        const newIndex = direction === 'up' ? index - 1 : index + 1;

        if (newIndex < 0 || newIndex >= newBookmarks.length) return;

        const temp = newBookmarks[index];
        newBookmarks[index] = newBookmarks[newIndex];
        newBookmarks[newIndex] = temp;

        setLocalBookmarks(newBookmarks);
        setHasChanges(true);
    };

    const handleSaveOrder = async () => {
        setIsSaving(true);
        try {
            await reorderBookmarks(localBookmarks);
            setHasChanges(false);
            onClose();
        } catch (error) {
            console.error('Error saving order:', error);
            alert('Error al guardar el orden');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('¿Eliminar este marcador?')) {
            await deleteBookmark(id);
        }
    };

    return (
        <BaseModal
            isOpen={isOpen}
            onClose={onClose}
            title="Gestionar Marcadores"
            icon={<GripVertical size={16} className="text-slate-400" />}
            variant="white"
            size="md"
            className="!rounded-xl"
        >
            <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-100 rounded-lg overflow-hidden">
                    <table className="w-full text-[11px]">
                        <thead>
                            <tr className="bg-white border-b border-slate-100 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                <th className="px-3 py-2 text-left w-10">Orden</th>
                                <th className="px-3 py-2 text-left">Nombre / URL</th>
                                <th className="px-3 py-2 text-right w-24">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {localBookmarks.map((bookmark, index) => (
                                <tr key={bookmark.id} className="hover:bg-white bg-slate-50/50 transition-colors group">
                                    <td className="px-3 py-2">
                                        <div className="flex flex-col gap-0.5">
                                            <button
                                                disabled={index === 0}
                                                onClick={(e) => { e.stopPropagation(); handleMove(index, 'up'); }}
                                                className="p-0.5 hover:bg-slate-100 rounded disabled:opacity-20 text-slate-400"
                                            >
                                                <ChevronUp size={12} />
                                            </button>
                                            <button
                                                disabled={index === localBookmarks.length - 1}
                                                onClick={(e) => { e.stopPropagation(); handleMove(index, 'down'); }}
                                                className="p-0.5 hover:bg-slate-100 rounded disabled:opacity-20 text-slate-400"
                                            >
                                                <ChevronDown size={12} />
                                            </button>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-base">{bookmark.icon}</span>
                                            <div className="flex flex-col min-w-0">
                                                <span className="font-bold text-slate-700 truncate">{bookmark.name}</span>
                                                <span className="text-slate-400 truncate text-[10px]">{bookmark.url}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="flex items-center justify-end gap-1 opacity-40 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onEdit(bookmark); }}
                                                className="p-1.5 hover:bg-blue-50 hover:text-blue-600 rounded-md transition-colors text-slate-400"
                                                title="Editar"
                                            >
                                                <Edit2 size={12} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDelete(bookmark.id); }}
                                                className="p-1.5 hover:bg-red-50 hover:text-red-600 rounded-md transition-colors text-slate-400"
                                                title="Eliminar"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {localBookmarks.length === 0 && (
                    <div className="py-8 text-center text-slate-400 text-xs italic">
                        No hay marcadores guardados
                    </div>
                )}

                <div className="pt-2 flex gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-4 py-2 text-slate-400 text-[10px] font-bold hover:bg-slate-50 rounded-lg transition-colors uppercase tracking-widest"
                    >
                        {hasChanges ? 'Descartar Cambios' : 'Cerrar'}
                    </button>
                    {hasChanges && (
                        <button
                            type="button"
                            onClick={handleSaveOrder}
                            disabled={isSaving}
                            className="flex-1 px-4 py-2 bg-medical-600 text-white text-[10px] font-bold rounded-lg hover:bg-medical-700 shadow-md shadow-medical-100 transition-all uppercase tracking-widest flex items-center justify-center gap-2"
                        >
                            {isSaving ? 'Guardando...' : (
                                <>
                                    <Save size={12} />
                                    Guardar Orden
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </BaseModal>
    );
};
