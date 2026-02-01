import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bookmark, BookmarkInput } from '@/types/bookmarks';
import {
    subscribeToBookmarks,
    addBookmark,
    updateBookmark,
    deleteBookmark,
    exportBookmarksToJson,
    importBookmarksFromJson,
    subscribeToBookmarkPreferences,
    saveBookmarkPreferences
} from '@/services/bookmarks/bookmarkService';
import {
    Plus,
    Settings2,
    Edit2,
    Download,
    Upload,
    List,
    AlignLeft,
    AlignCenter,
    AlignRight,
    SlidersHorizontal
} from 'lucide-react';
import { BookmarkEditorModal } from './BookmarkEditorModal';
import { BookmarkManagerModal } from './BookmarkManagerModal';
import clsx from 'clsx';

type AlignmentType = 'left' | 'center' | 'right' | 'custom';

export const BookmarkBar: React.FC = () => {
    const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
    const [showMenu, setShowMenu] = useState<'actions' | null>(null);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [isManagerOpen, setIsManagerOpen] = useState(false);
    const [editingBookmark, setEditingBookmark] = useState<Bookmark | undefined>();
    const [_isImporting, setIsImporting] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Alignment state - synced with Firestore
    const [alignment, setAlignment] = useState<AlignmentType>('left');
    const [customOffset, setCustomOffset] = useState(50);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Subscribe to bookmarks
    useEffect(() => {
        const unsubscribe = subscribeToBookmarks(setBookmarks);
        return () => unsubscribe();
    }, []);

    // Subscribe to preferences from Firestore
    useEffect(() => {
        const unsubscribe = subscribeToBookmarkPreferences((prefs) => {
            setAlignment(prefs.alignment);
            setCustomOffset(prefs.customOffset);
        });
        return () => unsubscribe();
    }, []);

    // Debounced save to Firestore
    const savePreferencesToFirestore = useCallback((newAlignment: AlignmentType, newOffset: number) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
            saveBookmarkPreferences({ alignment: newAlignment, customOffset: newOffset });
        }, 500);
    }, []);

    const handleAlignmentChange = (newAlignment: AlignmentType) => {
        setAlignment(newAlignment);
        savePreferencesToFirestore(newAlignment, customOffset);
    };

    const handleOffsetChange = (newOffset: number) => {
        setCustomOffset(newOffset);
        savePreferencesToFirestore(alignment, newOffset);
    };

    const getAlignmentClass = () => {
        switch (alignment) {
            case 'left': return 'justify-start';
            case 'center': return 'justify-center';
            case 'right': return 'justify-end';
            case 'custom': return '';
            default: return 'justify-start';
        }
    };

    const handleSave = async (input: BookmarkInput) => {
        if (editingBookmark) {
            await updateBookmark(editingBookmark.id, input);
        } else {
            await addBookmark(input, bookmarks.length);
        }
    };

    const handleEdit = (bookmark: Bookmark) => {
        setEditingBookmark(bookmark);
        setIsEditorOpen(true);
        setShowMenu(null);
    };

    const _handleDelete = async (id: string) => {
        if (window.confirm('¿Eliminar este marcador?')) {
            await deleteBookmark(id);
        }
        setShowMenu(null);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsImporting(true);
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const content = event.target?.result as string;
                await importBookmarksFromJson(content);
                alert('Marcadores importados con éxito');
            } catch (_error) {
                alert('Error al importar marcadores');
            } finally {
                setIsImporting(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        };
        reader.readAsText(file);
    };

    return (
        <div
            className="w-full bg-white/95 backdrop-blur-md border-b border-slate-100 sticky top-[112px] z-[30] print:hidden h-9 flex items-center px-4 overflow-visible group"
            style={{ transform: 'translateZ(0)' }}
        >
            <div
                className={clsx(
                    "flex items-center gap-1 overflow-x-auto no-scrollbar flex-1 py-1",
                    getAlignmentClass()
                )}
                style={alignment === 'custom' ? { paddingLeft: `${customOffset}%` } : undefined}
            >
                {bookmarks.map(bookmark => (
                    <div
                        key={bookmark.id}
                        className="relative group/item shrink-0"
                    >
                        <a
                            href={bookmark.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-50 transition-all text-slate-600 text-[11px] font-medium border border-transparent hover:border-slate-100"
                            title={bookmark.notes || bookmark.url}
                        >
                            <span className="text-sm leading-none">{bookmark.icon || '🔗'}</span>
                            <span className="truncate max-w-[120px]">{bookmark.name}</span>
                        </a>

                        {/* Inline controls on hover */}
                        <div className="absolute top-0 right-0 opacity-0 group-hover/item:opacity-100 transition-opacity flex">
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleEdit(bookmark);
                                }}
                                className="p-0.5 text-slate-300 hover:text-medical-600 bg-white border border-slate-100 rounded-full -mt-1 -mr-1 shadow-sm"
                            >
                                <Edit2 size={8} />
                            </button>
                        </div>
                    </div>
                ))}

                {bookmarks.length === 0 && (
                    <div className="w-4" />
                )}
            </div>

            <div className="flex items-center gap-0.5 pl-4 border-l border-slate-100 ml-2">
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setEditingBookmark(undefined);
                        setIsEditorOpen(true);
                    }}
                    className="p-1 text-slate-400 hover:text-medical-600 hover:bg-slate-50 rounded transition-all"
                    title="Agregar"
                >
                    <Plus size={14} />
                </button>

                <div className="relative">
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowMenu(showMenu === 'actions' ? null : 'actions');
                        }}
                        className={clsx(
                            "p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-50 rounded transition-all",
                            showMenu === 'actions' && "bg-white shadow-sm text-slate-900 border border-slate-100"
                        )}
                        title="Configuración"
                    >
                        <Settings2 size={14} />
                    </button>

                    {showMenu === 'actions' && (
                        <>
                            <div
                                className="fixed inset-0 z-[60]"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowMenu(null);
                                }}
                            />
                            <div className="absolute right-0 mt-2 w-44 bg-white rounded-lg shadow-xl border border-slate-100 py-1 z-[70] animate-in fade-in slide-in-from-top-1 duration-150">
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setShowMenu(null);
                                        setIsManagerOpen(true);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                    <List size={16} className="text-slate-400" />
                                    <span>Gestionar Marcadores</span>
                                </button>

                                <div className="h-px bg-slate-100 my-1" />

                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleImportClick();
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                    <Upload size={16} className="text-slate-400" />
                                    <span>Importar JSON</span>
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        exportBookmarksToJson();
                                        setShowMenu(null);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                >
                                    <Download size={16} className="text-slate-400" />
                                    <span>Exportar JSON</span>
                                </button>

                                <div className="h-px bg-slate-100 my-1" />

                                {/* Alignment Controls */}
                                <div className="px-4 py-2">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                                        Posición
                                    </p>
                                    <div className="flex items-center gap-1 mb-2">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleAlignmentChange('left'); }}
                                            className={clsx(
                                                "p-1.5 rounded transition-all",
                                                alignment === 'left' ? "bg-medical-100 text-medical-600" : "text-slate-400 hover:bg-slate-100"
                                            )}
                                            title="Izquierda"
                                        >
                                            <AlignLeft size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleAlignmentChange('center'); }}
                                            className={clsx(
                                                "p-1.5 rounded transition-all",
                                                alignment === 'center' ? "bg-medical-100 text-medical-600" : "text-slate-400 hover:bg-slate-100"
                                            )}
                                            title="Centro"
                                        >
                                            <AlignCenter size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleAlignmentChange('right'); }}
                                            className={clsx(
                                                "p-1.5 rounded transition-all",
                                                alignment === 'right' ? "bg-medical-100 text-medical-600" : "text-slate-400 hover:bg-slate-100"
                                            )}
                                            title="Derecha"
                                        >
                                            <AlignRight size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleAlignmentChange('custom'); }}
                                            className={clsx(
                                                "p-1.5 rounded transition-all",
                                                alignment === 'custom' ? "bg-medical-100 text-medical-600" : "text-slate-400 hover:bg-slate-100"
                                            )}
                                            title="Personalizado"
                                        >
                                            <SlidersHorizontal size={14} />
                                        </button>
                                    </div>
                                    {alignment === 'custom' && (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min="0"
                                                max="80"
                                                value={customOffset}
                                                onChange={(e) => { e.stopPropagation(); handleOffsetChange(parseInt(e.target.value, 10)); }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="flex-1 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-medical-600"
                                            />
                                            <span className="text-[10px] text-slate-500 w-8 text-right">{customOffset}%</span>
                                        </div>
                                    )}
                                </div>

                                <div className="h-px bg-slate-100 my-1" />
                                <div className="px-4 py-2">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                        Total: {bookmarks.length} marcadores
                                    </p>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json"
                className="hidden"
            />

            <BookmarkEditorModal
                isOpen={isEditorOpen}
                onClose={() => setIsEditorOpen(false)}
                onSave={handleSave}
                initialData={editingBookmark}
            />
            {isManagerOpen && (
                <BookmarkManagerModal
                    isOpen={isManagerOpen}
                    onClose={() => setIsManagerOpen(false)}
                    bookmarks={bookmarks}
                    onEdit={(bookmark) => {
                        setEditingBookmark(bookmark);
                        setIsManagerOpen(false);
                        setIsEditorOpen(true);
                    }}
                />
            )}
        </div>
    );
};
