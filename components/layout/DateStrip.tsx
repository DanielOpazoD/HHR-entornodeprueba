import React, { useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Settings, FileSpreadsheet, Send, Printer, Lock, Mail, Link as LinkIcon, ChevronDown, Copy, CloudUpload, Loader2, CheckCircle2, RefreshCw, Star } from 'lucide-react';
import clsx from 'clsx';
import { MONTH_NAMES } from '../../constants';

// ============================================================================
// Grouped Props Interfaces
// ============================================================================

/**
 * Date navigation state and setters
 */
export interface DateNavigationProps {
    selectedYear: number;
    setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
    selectedMonth: number;
    setSelectedMonth: React.Dispatch<React.SetStateAction<number>>;
    selectedDay: number;
    setSelectedDay: React.Dispatch<React.SetStateAction<number>>;
    currentDateString: string;
    daysInMonth: number;
    existingDaysInMonth: number[];
}

/**
 * Optional action callbacks for the DateStrip buttons
 */
export interface DateStripActionsProps {
    onPrintPDF?: () => void;
    onExportPDF?: () => void;
    onOpenBedManager?: () => void;
    onExportExcel?: () => void;
    onBackupExcel?: () => Promise<void>;
    isArchived?: boolean;
}

/**
 * Email configuration and status
 */
export interface EmailConfigProps {
    onConfigureEmail?: () => void;
    onSendEmail?: () => void;
    onGenerateShareLink?: () => void;
    onCopyShareLink?: () => void;
    emailStatus?: 'idle' | 'loading' | 'success' | 'error';
    emailErrorMessage?: string | null;
}

/**
 * Sync status for Firebase connection
 */
export interface SyncConfigProps {
    syncStatus?: 'idle' | 'saving' | 'saved' | 'error';
    lastSyncTime?: Date | null;
}

/**
 * Bookmark bar toggle props
 */
export interface BookmarkConfigProps {
    onToggleBookmarks?: () => void;
    showBookmarks?: boolean;
}

/**
 * Combined DateStrip props - composed from grouped interfaces
 */
export interface DateStripProps extends DateNavigationProps, DateStripActionsProps, EmailConfigProps, SyncConfigProps, BookmarkConfigProps { }

// ============================================================================
// Component Implementation
// ============================================================================

export const DateStrip: React.FC<DateStripProps> = ({
    // Date Navigation
    selectedYear, setSelectedYear,
    selectedMonth, setSelectedMonth,
    selectedDay, setSelectedDay,
    currentDateString,
    daysInMonth,
    existingDaysInMonth,
    // Actions
    onPrintPDF,
    onExportPDF,
    onOpenBedManager,
    onExportExcel,
    onBackupExcel,
    isArchived = false,
    // Email
    onConfigureEmail,
    onSendEmail,
    onGenerateShareLink,
    onCopyShareLink,
    emailStatus = 'idle',
    emailErrorMessage,
    // Sync (no longer displayed here, shown in Navbar instead)
    syncStatus: _syncStatus,
    lastSyncTime: _lastSyncTime,
    // Bookmarks
    onToggleBookmarks,
    showBookmarks
}) => {
    const daysContainerRef = useRef<HTMLDivElement>(null);
    const [showSendMenu, setShowSendMenu] = React.useState(false);
    const [isBackingUp, setIsBackingUp] = React.useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowSendMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const changeMonth = (delta: number) => {
        let newM = selectedMonth + delta;
        let newY = selectedYear;
        if (newM > 11) { newM = 0; newY++; }
        if (newM < 0) { newM = 11; newY--; }
        setSelectedMonth(newM);
        setSelectedYear(newY);
        setSelectedDay(1);
    };

    // Check if today is selected
    const today = new Date();
    const isCurrentMonth = today.getMonth() === selectedMonth && today.getFullYear() === selectedYear;

    // Navigate days with scroll wheel (independent of page scroll)
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.deltaY > 0) {
            // Scroll down = go forward in days
            setSelectedDay(d => Math.min(d + 1, daysInMonth));
        } else if (e.deltaY < 0) {
            // Scroll up = go back in days
            setSelectedDay(d => Math.max(d - 1, 1));
        }
    }, [daysInMonth, setSelectedDay]);

    return (
        <div
            className="bg-white border-b border-slate-200 shadow-sm sticky top-[60px] z-40 print:hidden"
            style={{ transform: 'translateZ(0)' }}
        >
            <div className="max-w-screen-2xl mx-auto px-4 py-1.5">
                <div className="flex items-center gap-3">
                    {/* Bookmark Toggle */}
                    {onToggleBookmarks && (
                        <button
                            onClick={onToggleBookmarks}
                            className={clsx(
                                "p-1.5 rounded-lg transition-all shrink-0",
                                showBookmarks ? "text-medical-600 bg-medical-50" : "text-slate-400 hover:bg-slate-100"
                            )}
                            title={showBookmarks ? "Ocultar Marcadores" : "Mostrar Marcadores"}
                        >
                            <Star size={14} className={clsx(showBookmarks ? "text-amber-500 fill-amber-500" : "text-slate-400")} />
                        </button>
                    )}

                    {/* Print PDF Button */}
                    {onPrintPDF && (
                        <div className="flex items-center gap-1">
                            <button
                                onClick={onPrintPDF}
                                className="btn btn-secondary bg-slate-800 text-white hover:bg-slate-900 border-none !px-3 !py-1.5 text-[10px]"
                                title="Imprimir vista en PDF (nativo)"
                            >
                                <Printer size={14} />
                                PDF
                            </button>
                            {/* NEW: Lightweight PDF Button */}
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
                    )}

                    {/* Excel Export Button */}
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

                    {/* Backup Excel Button */}
                    {onBackupExcel && (
                        <button
                            onClick={async () => {
                                setIsBackingUp(true);
                                try {
                                    await onBackupExcel();
                                } finally {
                                    setIsBackingUp(false);
                                }
                            }}
                            disabled={isBackingUp}
                            className={clsx(
                                "btn border-none !px-3 !py-1.5 text-[10px] disabled:opacity-70 transition-all",
                                isArchived && !isBackingUp
                                    ? "bg-emerald-600 hover:bg-amber-500 text-white"
                                    : "bg-amber-500 hover:bg-amber-600 text-white"
                            )}
                            title={isArchived ? "Archivo guardado - Clic para actualizar" : "Guardar Excel en Archivos (Cloud Backup)"}
                        >
                            {isBackingUp ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : isArchived ? (
                                <CheckCircle2 size={14} />
                            ) : (
                                <CloudUpload size={14} />
                            )}
                            {isBackingUp ? 'Guardando...' : isArchived ? 'Archivado ✓' : 'Archivar'}
                        </button>
                    )}

                    {/* Send Email Button with Dropdown Options */}
                    {onSendEmail && (
                        <div className="relative" ref={menuRef}>
                            <div className="flex">
                                <button
                                    onClick={onGenerateShareLink ? () => setShowSendMenu(!showSendMenu) : onSendEmail}
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
                                    {onGenerateShareLink && <ChevronDown size={14} className={clsx("transition-transform", showSendMenu && "rotate-180")} />}
                                </button>

                                {!onGenerateShareLink && (
                                    <div className="hidden"></div> // Empty for layout consistency if needed
                                )}
                            </div>

                            {/* Dropdown Menu */}
                            {showSendMenu && onGenerateShareLink && (
                                <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                                    <div className="px-3 py-2 border-b border-slate-100 mb-1">
                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Opciones de Envío</p>
                                    </div>

                                    <button
                                        onClick={() => {
                                            setShowSendMenu(false);
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
                                            setShowSendMenu(false);
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
                                            setShowSendMenu(false);
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
                    )}

                    {/* Configure Email Button */}
                    {onConfigureEmail && (
                        <button
                            onClick={onConfigureEmail}
                            className="btn btn-secondary !p-1.5"
                            title="Configurar destinatarios y mensaje"
                            aria-label="Configurar correo"
                        >
                            <Settings size={14} />
                        </button>
                    )}

                    <div className="h-5 w-px bg-slate-200"></div>

                    {/* Year Selector */}
                    <div className="flex items-center text-slate-700 font-bold shrink-0">
                        <button onClick={() => setSelectedYear(y => y - 1)} className="p-1 hover:bg-slate-100 rounded">
                            <ChevronLeft size={14} />
                        </button>
                        <span className="mx-1 text-sm font-bold">{selectedYear}</span>
                        <button onClick={() => setSelectedYear(y => y + 1)} className="p-1 hover:bg-slate-100 rounded">
                            <ChevronRight size={14} />
                        </button>
                    </div>

                    <div className="h-5 w-px bg-slate-200"></div>

                    {/* Month Selector */}
                    <div className="flex items-center text-slate-700 font-bold shrink-0">
                        <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-slate-100 rounded">
                            <ChevronLeft size={14} />
                        </button>
                        <span className="mx-1 uppercase text-xs tracking-wide min-w-[80px] text-center">{MONTH_NAMES[selectedMonth]}</span>
                        <button onClick={() => changeMonth(1)} className="p-1 hover:bg-slate-100 rounded">
                            <ChevronRight size={14} />
                        </button>
                    </div>

                    <div className="h-5 w-px bg-slate-200"></div>

                    {/* Day Strip - Scrollable with mouse wheel */}
                    <div
                        ref={daysContainerRef}
                        className="flex gap-1 py-1 overflow-hidden flex-1 justify-center"
                        onWheel={handleWheel}
                    >
                        {(() => {
                            // Calculate visible range: 6 days before + selected + 6 days after = 13 days
                            const VISIBLE_DAYS = 13;
                            const OFFSET = 6;

                            let startDay = selectedDay - OFFSET;
                            let endDay = selectedDay + OFFSET;

                            // Adjust if we're near the start of the month
                            if (startDay < 1) {
                                startDay = 1;
                                endDay = Math.min(VISIBLE_DAYS, daysInMonth);
                            }

                            // Adjust if we're near the end of the month
                            if (endDay > daysInMonth) {
                                endDay = daysInMonth;
                                startDay = Math.max(1, daysInMonth - VISIBLE_DAYS + 1);
                            }

                            // Calculate Max Allowed Date (Today + 1)
                            const maxAllowedDate = new Date();
                            maxAllowedDate.setHours(0, 0, 0, 0);
                            maxAllowedDate.setDate(maxAllowedDate.getDate() + 1); // Tomorrow is the last allowed day

                            const days = [];
                            for (let day = startDay; day <= endDay; day++) {
                                const hasData = existingDaysInMonth.includes(day);
                                const isSelected = day === selectedDay;
                                const isTodayReal = isCurrentMonth && today.getDate() === day;

                                // Construct date for this button
                                const buttonDate = new Date(selectedYear, selectedMonth, day);
                                buttonDate.setHours(0, 0, 0, 0);

                                const isFutureBlocked = buttonDate > maxAllowedDate;

                                days.push(
                                    <button
                                        key={day}
                                        onClick={() => !isFutureBlocked && setSelectedDay(day)}
                                        disabled={isFutureBlocked}
                                        className={clsx(
                                            "flex items-center justify-center w-8 h-8 rounded-lg text-xs font-semibold transition-all shrink-0 relative border",
                                            isFutureBlocked
                                                ? "bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed"
                                                : isSelected
                                                    ? isTodayReal
                                                        // Today selected: bright cyan/teal color
                                                        ? "bg-gradient-to-br from-cyan-500 to-teal-500 text-white border-cyan-600 shadow-lg shadow-cyan-200 scale-110"
                                                        // Other day selected: slate color
                                                        : "bg-slate-700 text-white border-slate-700 shadow-md scale-105"
                                                    : [
                                                        "hover:bg-slate-100",
                                                        isTodayReal
                                                            // Today not selected: highlighted but not as much
                                                            ? "bg-cyan-50 border-cyan-300 text-cyan-700 font-bold"
                                                            : "bg-white border-slate-100 text-slate-500"
                                                    ]
                                        )}
                                    >
                                        <span>{day}</span>
                                        {hasData && (
                                            <span className={clsx(
                                                "absolute -bottom-0.5 w-1 h-1 rounded-full",
                                                isFutureBlocked ? "bg-slate-300" : (isSelected ? "bg-green-400" : "bg-green-500")
                                            )}></span>
                                        )}
                                    </button>
                                );
                            }
                            return days;
                        })()}
                    </div>

                    <div className="h-5 w-px bg-slate-200"></div>

                    {/* Right Side Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                        {/* Bed Manager Button */}
                        {onOpenBedManager && (
                            <button
                                onClick={onOpenBedManager}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-md border border-slate-200 transition-colors text-[11px] font-semibold"
                                title="Bloqueo de camas"
                            >
                                <Lock size={14} />
                                <span className="hidden sm:inline">Camas</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
