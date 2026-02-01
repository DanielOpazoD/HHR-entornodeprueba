/**
 * DateStrip Action Buttons
 * Extracted action buttons for PDF, Excel, Backup, and Email functionality.
 */

import React from 'react';
import {
    FileSpreadsheet,
    Send,
    Printer,
    Mail,
    ChevronDown,
    Loader2,
    Save,
    CheckCircle,
    Settings
} from 'lucide-react';
import clsx from 'clsx';

// ============================================================================
// Props Interfaces
// ============================================================================

export interface ActionButtonsProps {
    // PDF Actions
    onExportPDF?: () => void;
    // Excel Actions
    onExportExcel?: () => void;
    onBackupExcel?: () => Promise<void>;
    isArchived?: boolean;
    // Email Actions
    onSendEmail?: () => void;
    onGenerateShareLink?: () => void;
    onCopyShareLink?: () => void;
    emailStatus?: 'idle' | 'loading' | 'success' | 'error';
    emailErrorMessage?: string | null;
}

// ============================================================================
// PDF Buttons Component
// ============================================================================

export const PdfButtons: React.FC<Pick<ActionButtonsProps, 'onExportPDF'>> = ({
    onExportPDF
}) => {
    if (!onExportPDF) return null;

    return (
        <div className="flex items-center gap-1">
            <button
                onClick={onExportPDF}
                className="btn btn-secondary bg-teal-700 text-white hover:bg-teal-800 border-none !px-3 !py-1.5 text-[10px]"
                title="Descargar PDF (rápido)"
            >
                <Printer size={14} />
                PDF
            </button>
        </div>
    );
};

// ============================================================================
// Save Dropdown Component (Combined Excel & Backup)
// ============================================================================

interface SaveDropdownProps {
    onExportExcel?: () => void;
    onBackupExcel?: () => Promise<void>;
    isArchived?: boolean;
    isBackingUp: boolean;
}

export const SaveDropdown: React.FC<SaveDropdownProps> = ({
    onExportExcel,
    onBackupExcel,
    isArchived = false,
    isBackingUp
}) => {
    const [showMenu, setShowMenu] = React.useState(false);
    const menuRef = React.useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleAction = async (action: 'excel' | 'backup') => {
        setShowMenu(false);
        if (action === 'excel') {
            onExportExcel?.();
        } else {
            await onBackupExcel?.();
        }
    };

    if (!onExportExcel && !onBackupExcel) return null;

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setShowMenu(!showMenu)}
                disabled={isBackingUp}
                className={clsx(
                    "btn !px-3 !py-1.5 text-[10px] flex items-center gap-1.5 transition-all",
                    isBackingUp
                        ? "bg-amber-100 text-amber-700 border-amber-200"
                        : isArchived
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm"
                            : "btn-primary bg-amber-500 hover:bg-amber-600 border-none shadow-sm"
                )}
                title="Opciones de guardado"
            >
                {isBackingUp ? (
                    <Loader2 size={14} className="animate-spin" />
                ) : isArchived ? (
                    <CheckCircle size={14} />
                ) : (
                    <Save size={14} />
                )}
                <span className="font-bold">
                    {isBackingUp ? 'Guardando...' : isArchived ? 'Sincronizado' : 'Guardar'}
                </span>
                <ChevronDown size={14} className={clsx("transition-transform", showMenu && "rotate-180")} />
            </button>

            {showMenu && (
                <div className="absolute top-full left-0 mt-1 w-52 bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-2 border-b border-slate-100 mb-1">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Opciones de Guardado</p>
                    </div>

                    <button
                        onClick={() => handleAction('backup')}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 group transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 group-hover:bg-amber-100">
                            <Save size={16} />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-700">Respaldo en Firebase</p>
                            <p className="text-[10px] text-slate-500">Respaldo seguro en Firebase</p>
                        </div>
                    </button>

                    <button
                        onClick={() => handleAction('excel')}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 group transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-green-50 flex items-center justify-center text-green-600 group-hover:bg-green-100">
                            <FileSpreadsheet size={16} />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-700">Descargar Local</p>
                            <p className="text-[10px] text-slate-500">Exportar planilla Excel</p>
                        </div>
                    </button>
                </div>
            )}
        </div>
    );
};

// ============================================================================
// Handoff Save Dropdown Component (Combined PDF & Cloud Backup)
// ============================================================================

interface HandoffSaveDropdownProps {
    onExportPDF?: () => void;
    onBackupPDF?: (skipConfirmation?: boolean) => Promise<void>;
    isArchived?: boolean;
    isBackingUp: boolean;
}

export const HandoffSaveDropdown: React.FC<HandoffSaveDropdownProps> = ({
    onExportPDF,
    onBackupPDF,
    isArchived = false,
    isBackingUp
}) => {
    const [showMenu, setShowMenu] = React.useState(false);
    const menuRef = React.useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleAction = async (action: 'pdf' | 'backup') => {
        setShowMenu(false);
        if (action === 'pdf') {
            // "Al apretar descarga local no pidas confirmación"
            await onBackupPDF?.(true);
            onExportPDF?.();
        } else {
            // Manual cloud backup still asks for confirmation
            await onBackupPDF?.(false);
        }
    };

    if (!onExportPDF && !onBackupPDF) return null;

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setShowMenu(!showMenu)}
                disabled={isBackingUp}
                className={clsx(
                    "btn !px-3 !py-1.5 text-[10px] flex items-center gap-1.5 transition-all",
                    isBackingUp
                        ? "bg-slate-100 text-slate-400 border-slate-200"
                        : isArchived
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white border-none shadow-sm"
                            : "btn-primary bg-amber-500 hover:bg-amber-600 border-none shadow-sm"
                )}
                title="Opciones de guardado (PDF/Nube)"
            >
                {isBackingUp ? (
                    <Loader2 size={14} className="animate-spin" />
                ) : isArchived ? (
                    <CheckCircle size={14} />
                ) : (
                    <Save size={14} />
                )}
                <span className="font-bold uppercase tracking-tighter">
                    {isBackingUp ? 'Guardando...' : isArchived ? 'Sincronizado' : 'Guardar'}
                </span>
                <ChevronDown size={14} className={clsx("transition-transform", showMenu && "rotate-180")} />
            </button>

            {showMenu && (
                <div className="absolute top-full left-0 mt-1 w-52 bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-2 border-b border-slate-100 mb-1">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Opciones de Guardado</p>
                    </div>

                    <button
                        onClick={() => handleAction('pdf')}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 group transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-100">
                            <Printer size={16} />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-700">Descarga local</p>
                            <p className="text-[10px] text-slate-500">Exportar como PDF</p>
                        </div>
                    </button>

                    <button
                        onClick={() => handleAction('backup')}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 group transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 group-hover:bg-amber-100">
                            <Save size={16} />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-700">Respaldo en Firebase</p>
                            <p className="text-[10px] text-slate-500">Respaldo seguro en Firebase</p>
                        </div>
                    </button>
                </div>
            )}
        </div>
    );
};

interface EmailDropdownProps {
    onSendEmail?: () => void;
    onCopyShareLink?: () => void;
    onConfigureEmail?: () => void;
    emailStatus?: 'idle' | 'loading' | 'success' | 'error';
    emailErrorMessage?: string | null;
    showMenu: boolean;
    setShowMenu: (value: boolean) => void;
    menuRef: React.RefObject<HTMLDivElement | null>;
}

export const EmailDropdown: React.FC<EmailDropdownProps> = ({
    onSendEmail,
    onCopyShareLink: _onCopyShareLink, // hidden
    onConfigureEmail,
    emailStatus = 'idle',
    emailErrorMessage,
    showMenu,
    setShowMenu,
    menuRef
}) => {
    if (!onSendEmail) return null;

    return (
        <div className="relative" ref={menuRef}>
            <div className="flex">
                <button
                    onClick={() => setShowMenu(!showMenu)}
                    disabled={emailStatus === 'loading'}
                    className={clsx(
                        "btn !py-1.5 text-[10px] flex items-center gap-1",
                        "!px-2 rounded-r-none border-r border-blue-500/30",
                        emailStatus === 'success'
                            ? 'bg-blue-700 text-white shadow-inner'
                            : 'btn-primary bg-blue-600 hover:bg-blue-700',
                        emailStatus === 'loading' && 'opacity-70 cursor-not-allowed'
                    )}
                    title={emailStatus === 'error' ? (emailErrorMessage || 'Ocurrió un error al enviar el correo') : "Enviar censo"}
                >
                    <Send size={14} />
                    {emailStatus === 'loading' ? 'Enviando...' : emailStatus === 'success' ? 'Enviado' : 'Enviar censo'}
                    <ChevronDown size={14} className={clsx("transition-transform", showMenu && "rotate-180")} />
                </button>
            </div>

            {/* Dropdown Menu */}
            {showMenu && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-2 border-b border-slate-100 mb-1">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Opciones de Envío</p>
                    </div>

                    <button
                        onClick={() => {
                            setShowMenu(false);
                            onSendEmail?.();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 group transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-100">
                            <Mail size={16} />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-700">Enviar Archivo Excel</p>
                            <p className="text-[10px] text-slate-500">Adjunto clásico con contraseña</p>
                        </div>
                    </button>

                    {onConfigureEmail && (
                        <button
                            onClick={() => {
                                setShowMenu(false);
                                onConfigureEmail();
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 group transition-colors"
                        >
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 group-hover:bg-slate-200">
                                <Settings size={16} />
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-700">Configuración</p>
                                <p className="text-[10px] text-slate-500">Destinatarios y mensaje</p>
                            </div>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
