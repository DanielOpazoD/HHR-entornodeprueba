/**
 * DateStrip Component
 * Navigation bar with date selection, action buttons, and export functionality.
 * Refactored to use extracted sub-components for better maintainability.
 */

import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Lock, ChevronDown, Box, LayoutGrid } from 'lucide-react';
import clsx from 'clsx';
import { MONTH_NAMES } from '@/constants';
import { PdfButtons, SaveDropdown, HandoffSaveDropdown, EmailDropdown } from './DateStripActions';

// ============================================================================
// Props Interfaces
// ============================================================================

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
    navigateDays: (delta: number) => void;
}

export interface DateStripActionsProps {
    onExportPDF?: () => void;
    onOpenBedManager?: () => void;
    onExportExcel?: () => void;
    onBackupExcel?: () => Promise<void>;
    onBackupPDF?: () => Promise<void>;
    isArchived?: boolean;
    onBackupExcelStatus?: boolean;
}

export interface EmailConfigProps {
    onConfigureEmail?: () => void;
    onSendEmail?: () => void;
    onCopyShareLink?: () => void;
    emailStatus?: 'idle' | 'loading' | 'success' | 'error';
    emailErrorMessage?: string | null;
}

export interface SyncConfigProps {
    syncStatus?: 'idle' | 'saving' | 'saved' | 'error';
    lastSyncTime?: Date | null;
}

export interface BookmarkConfigProps {
    onToggleBookmarks?: () => void;
    showBookmarks?: boolean;
    role?: string;
}

export interface DateStripProps extends DateNavigationProps, DateStripActionsProps, EmailConfigProps, SyncConfigProps, BookmarkConfigProps {
    localViewMode: 'TABLE' | '3D';
    setLocalViewMode: (v: 'TABLE' | '3D') => void;
    isBackingUp: boolean;
    currentModule: string;
}

// ============================================================================
// Component Implementation
// ============================================================================

export const DateStrip: React.FC<DateStripProps> = ({
    // Date Navigation
    selectedYear, setSelectedYear,
    selectedMonth, setSelectedMonth,
    selectedDay, setSelectedDay,
    navigateDays,

    daysInMonth,
    existingDaysInMonth,
    // Actions
    onExportPDF,
    onOpenBedManager,
    onExportExcel,
    onBackupExcel,
    onBackupPDF,
    isArchived = false,
    // Email
    onConfigureEmail,
    onSendEmail,
    onCopyShareLink,
    emailStatus = 'idle',
    emailErrorMessage,
    // Sync (shown in Navbar instead)
    syncStatus: _syncStatus,
    lastSyncTime: _lastSyncTime,
    // Bookmarks
    onToggleBookmarks,
    showBookmarks,
    role,
    localViewMode,
    setLocalViewMode,
    isBackingUp,
    currentModule
}) => {
    const daysContainerRef = useRef<HTMLDivElement>(null);
    const [showSendMenu, setShowSendMenu] = React.useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const isGuest = role === 'viewer';

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

    const today = new Date();
    const isCurrentMonth = today.getMonth() === selectedMonth && today.getFullYear() === selectedYear;

    // Navigate days with scroll wheel - using native event to prevent page scroll
    React.useEffect(() => {
        const container = daysContainerRef.current;
        if (!container) return;

        const handleNativeWheel = (e: WheelEvent) => {
            // Prevent page scroll
            e.preventDefault();

            if (e.deltaY > 0) {
                navigateDays(1);
            } else if (e.deltaY < 0) {
                navigateDays(-1);
            }
        };

        container.addEventListener('wheel', handleNativeWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleNativeWheel);
    }, [navigateDays]);

    return (
        <div
            className="bg-white border-b border-slate-200 shadow-sm sticky top-[64px] z-40 print:hidden h-[48px] flex items-center"
            style={{ transform: 'translateZ(0)' }}
        >
            <div className="max-w-screen-2xl mx-auto px-4 py-1.5">
                <div className="flex items-center gap-3">
                    {/* Bookmark Toggle - Hidden for Guests */}
                    {!isGuest && onToggleBookmarks && (
                        <button
                            onClick={onToggleBookmarks}
                            className={clsx(
                                "p-1.5 rounded-lg transition-all shrink-0",
                                showBookmarks ? "text-medical-600 bg-medical-50" : "text-slate-400 hover:bg-slate-100"
                            )}
                            title={showBookmarks ? "Ocultar Marcadores" : "Mostrar Marcadores"}
                        >
                            <ChevronDown
                                size={16}
                                className={clsx(
                                    "transition-transform duration-300",
                                    showBookmarks ? "rotate-180 text-medical-600" : "text-slate-400"
                                )}
                            />
                        </button>
                    )}

                    {/* Actions - PDF / Excel / Save */}
                    <div className="flex items-center gap-1">
                        {/* Handoff Actions (Handoff mode) */}
                        {currentModule === 'NURSING_HANDOFF' && !isGuest && (
                            <HandoffSaveDropdown
                                onExportPDF={onExportPDF}
                                onBackupPDF={onBackupPDF}
                                isArchived={isArchived}
                                isBackingUp={isBackingUp}
                            />
                        )}

                        {/* Census Actions (Census mode) */}
                        {currentModule === 'CENSUS' && (
                            <>
                                <PdfButtons onExportPDF={onExportPDF} />
                                {!isGuest && (
                                    <SaveDropdown
                                        onExportExcel={onExportExcel}
                                        onBackupExcel={onBackupExcel}
                                        isArchived={isArchived}
                                        isBackingUp={isBackingUp}
                                    />
                                )}
                            </>
                        )}
                    </div>

                    {/* Email Dropdown - Hidden for Guests */}
                    {!isGuest && (
                        <EmailDropdown
                            onSendEmail={onSendEmail}
                            onCopyShareLink={onCopyShareLink}
                            onConfigureEmail={onConfigureEmail}
                            emailStatus={emailStatus}
                            emailErrorMessage={emailErrorMessage}
                            showMenu={showSendMenu}
                            setShowMenu={setShowSendMenu}
                            menuRef={menuRef}
                        />
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

                    {/* Day Strip */}
                    <div
                        ref={daysContainerRef}
                        className="flex gap-1 py-1 overflow-hidden flex-1 justify-center"
                    >
                        <DayButtons
                            selectedDay={selectedDay}
                            setSelectedDay={setSelectedDay}
                            daysInMonth={daysInMonth}
                            existingDaysInMonth={existingDaysInMonth}
                            selectedYear={selectedYear}
                            selectedMonth={selectedMonth}
                            isCurrentMonth={isCurrentMonth}
                            today={today}
                        />
                    </div>

                    <div className="h-5 w-px bg-slate-200"></div>

                    {/* Bed Manager Button */}
                    <div className="flex items-center gap-1">
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

                        <button
                            onClick={() => setLocalViewMode(localViewMode === 'TABLE' ? '3D' : 'TABLE')}
                            className={clsx(
                                "flex items-center justify-center p-1.5 rounded-md border transition-all",
                                localViewMode === '3D'
                                    ? "bg-indigo-600 text-white border-indigo-700 shadow-sm"
                                    : "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                            )}
                            title={localViewMode === '3D' ? "Volver a Tabla" : "Ver Mapa 3D"}
                        >
                            {localViewMode === '3D' ? <LayoutGrid size={15} /> : <Box size={15} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// Day Buttons Renderer (Helper Function)
// ============================================================================

interface RenderDayButtonsProps {
    selectedDay: number;
    setSelectedDay: React.Dispatch<React.SetStateAction<number>>;
    daysInMonth: number;
    existingDaysInMonth: number[];
    selectedYear: number;
    selectedMonth: number;
    isCurrentMonth: boolean;
    today: Date;
}

const DayButtons = ({
    selectedDay,
    setSelectedDay,
    daysInMonth,
    existingDaysInMonth,
    selectedYear,
    selectedMonth,
    isCurrentMonth,
    today
}: RenderDayButtonsProps) => {
    // Dynamic visible days based on screen width for tablet optimization
    const [windowWidth, setWindowWidth] = React.useState(typeof window !== 'undefined' ? window.innerWidth : 1200);

    React.useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const isTablet = windowWidth < 1024;
    const isMobile = windowWidth < 640;

    const VISIBLE_DAYS = isMobile ? 5 : isTablet ? 7 : 13;
    const OFFSET = Math.floor(VISIBLE_DAYS / 2);

    let startDay = selectedDay - OFFSET;
    let endDay = selectedDay + OFFSET;

    if (startDay < 1) {
        startDay = 1;
        endDay = Math.min(VISIBLE_DAYS, daysInMonth);
    }

    if (endDay > daysInMonth) {
        endDay = daysInMonth;
        startDay = Math.max(1, daysInMonth - VISIBLE_DAYS + 1);
    }

    const maxAllowedDate = new Date();
    maxAllowedDate.setHours(0, 0, 0, 0);
    maxAllowedDate.setDate(maxAllowedDate.getDate() + 1);

    const days = [];
    for (let day = startDay; day <= endDay; day++) {
        const hasData = existingDaysInMonth.includes(day);
        const isSelected = day === selectedDay;
        const isTodayReal = isCurrentMonth && today.getDate() === day;

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
                                ? "bg-gradient-to-br from-cyan-500 to-teal-500 text-white border-cyan-600 shadow-lg shadow-cyan-200 scale-110"
                                : "bg-slate-700 text-white border-slate-700 shadow-md scale-105"
                            : [
                                "hover:bg-slate-100",
                                isTodayReal
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
};
