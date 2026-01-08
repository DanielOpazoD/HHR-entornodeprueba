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
    Link as LinkIcon,
    ChevronDown,
    Copy,
    CloudUpload,
    Loader2,
    CheckCircle2,
    Save,
    CheckCircle
} from 'lucide-react';
import clsx from 'clsx';

// ============================================================================
// Props Interfaces
// ============================================================================

export interface ActionButtonsProps {
    // PDF Actions
    onPrintPDF?: () => void;
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

export const PdfButtons: React.FC<Pick<ActionButtonsProps, 'onPrintPDF' | 'onExportPDF'>> = ({
    onPrintPDF,
    onExportPDF
}) => {
    if (!onPrintPDF) return null;

    return (
        <div className="flex items-center gap-1">
            <button
                onClick={onPrintPDF}
                className="btn btn-secondary bg-slate-800 text-white hover:bg-slate-900 border-none !px-3 !py-1.5 text-[10px]"
                title="Imprimir vista en PDF (nativo)"
            >
                <Printer size={14} />
                PDF
            </button>
            {onExportPDF && (
                <button
                    onClick={onExportPDF}
                    className="btn btn-secondary bg-teal-700 text-white hover:bg-teal-800 border-none !px-3 !py-1.5 text-[10px]"
                    title="Descargar PDF Ultra-Ligero (rápido)"
                >
                    <Printer size={14} />
                    PDF (Lite)
                </button>
            )}
        </div>
    );
};

// ============================================================================
// Excel Buttons Component
// ============================================================================

interface ExcelButtonsProps {
    onExportExcel?: () => void;
    onBackupExcel?: () => Promise<void>;
    isArchived?: boolean;
    isBackingUp: boolean;
    setIsBackingUp: (value: boolean) => void;
}

export const ExcelButtons: React.FC<ExcelButtonsProps> = ({
    onExportExcel,
    onBackupExcel,
    isArchived = false,
    isBackingUp,
    setIsBackingUp
}) => {
    const handleBackup = async () => {
        if (!onBackupExcel) return;
        setIsBackingUp(true);
        try {
            await onBackupExcel();
        } finally {
            setIsBackingUp(false);
        }
    };

    return (
        <>
            {onExportExcel && (
                <button
                    onClick={onExportExcel}
                    className="btn btn-primary bg-green-600 hover:bg-green-700 border-none !px-3 !py-1.5 text-[10px]"
                    title="Descargar Excel Maestro del Mes"
                >
                    <FileSpreadsheet size={14} />
                    EXCEL
                </button>
            )}

            {onBackupExcel && (
                <button
                    onClick={handleBackup}
                    disabled={isBackingUp}
                    className={clsx(
                        "btn border-none !px-3 !py-1.5 text-[10px] disabled:opacity-70 transition-all",
                        isArchived && !isBackingUp
                            ? "bg-emerald-600 hover:bg-amber-500 text-white"
                            : "bg-amber-500 hover:bg-amber-600 text-white"
                    )}
                    title={isArchived ? 'Actualizar respaldo existente' : 'Guardar censo del día'}
                >
                    {isBackingUp ? (
                        <Loader2 size={16} className="animate-spin" />
                    ) : isArchived ? (
                        <CheckCircle size={16} />
                    ) : (
                        <Save size={16} />
                    )}
                    <span>
                        {isBackingUp ? 'Guardando...' : isArchived ? 'Guardado ✓' : 'Guardar'}
                    </span>
                </button>
            )}
        </>
    );
};

// ============================================================================
// Email Dropdown Component
// ============================================================================

interface EmailDropdownProps {
    onSendEmail?: () => void;
    onGenerateShareLink?: () => void;
    onCopyShareLink?: () => void;
    emailStatus?: 'idle' | 'loading' | 'success' | 'error';
    emailErrorMessage?: string | null;
    showMenu: boolean;
    setShowMenu: (value: boolean) => void;
    menuRef: React.RefObject<HTMLDivElement>;
}

export const EmailDropdown: React.FC<EmailDropdownProps> = ({
    onSendEmail,
    onGenerateShareLink,
    onCopyShareLink,
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
                    onClick={onGenerateShareLink ? () => setShowMenu(!showMenu) : onSendEmail}
                    disabled={emailStatus === 'loading'}
                    className={clsx(
                        "btn !py-1.5 text-[10px] flex items-center gap-1",
                        onGenerateShareLink ? "!px-2 rounded-r-none border-r border-blue-500/30" : "!px-3",
                        emailStatus === 'success'
                            ? 'bg-blue-700 text-white shadow-inner'
                            : 'btn-primary bg-blue-600 hover:bg-blue-700',
                        emailStatus === 'loading' && 'opacity-70 cursor-not-allowed'
                    )}
                    title={emailStatus === 'error' ? (emailErrorMessage || 'Ocurrió un error al enviar el correo') : "Enviar censo"}
                >
                    <Send size={14} />
                    {emailStatus === 'loading' ? 'Enviando...' : emailStatus === 'success' ? 'Enviado' : 'Enviar censo'}
                    {onGenerateShareLink && <ChevronDown size={14} className={clsx("transition-transform", showMenu && "rotate-180")} />}
                </button>
            </div>

            {/* Dropdown Menu */}
            {showMenu && onGenerateShareLink && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-3 py-2 border-b border-slate-100 mb-1">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Opciones de Envío</p>
                    </div>

                    <button
                        onClick={() => {
                            setShowMenu(false);
                            onSendEmail?.();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 group transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 group-hover:bg-blue-100">
                            <Mail size={16} />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-700">Enviar Archivo Excel</p>
                            <p className="text-[10px] text-slate-500">Adjunto clásico con contraseña</p>
                        </div>
                    </button>

                    <button
                        onClick={() => {
                            setShowMenu(false);
                            onGenerateShareLink?.();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 group transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-teal-50 flex items-center justify-center text-teal-600 group-hover:bg-teal-100">
                            <LinkIcon size={16} />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-700">Enviar Link de Acceso</p>
                            <p className="text-[10px] text-slate-500">Recomendado (sin adjuntos)</p>
                        </div>
                    </button>

                    <button
                        onClick={() => {
                            setShowMenu(false);
                            onCopyShareLink?.();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 group transition-colors"
                    >
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 group-hover:bg-slate-200">
                            <Copy size={16} />
                        </div>
                        <div>
                            <p className="text-xs font-semibold text-slate-700">Copiar Link de Acceso</p>
                            <p className="text-[10px] text-slate-500">Para pegar en mensaje manual</p>
                        </div>
                    </button>

                    <div className="p-2 bg-slate-50 mt-1 rounded-b-lg border-t border-slate-100">
                        <p className="text-[9px] text-slate-400 italic leading-tight">
                            El link permite ver el censo del mes actual y anterior de forma segura.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};
