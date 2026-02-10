import React, { useState, useRef, useEffect } from 'react';
import clsx from 'clsx';
import { Printer, ChevronDown } from 'lucide-react';
import { BedDefinition, DailyRecord } from '@/types';
import { HandoffPatientTable } from './HandoffPatientTable';

interface MedicalHandoffTabsProps {
    visibleBeds: BedDefinition[];
    record: DailyRecord;
    noteField: 'handoffNoteDayShift' | 'handoffNoteNightShift' | 'medicalHandoffNote';
    onNoteChange: (bedId: string, value: string, isNested: boolean) => void;
    tableHeaderClass: string;
    readOnly: boolean;
    isMedical: boolean;
    shouldShowPatient: (bedId: string) => boolean;
}

type PrintMode = 'all' | 'upc' | 'no-upc';

export const MedicalHandoffTabs: React.FC<MedicalHandoffTabsProps> = ({
    visibleBeds,
    record,
    noteField,
    onNoteChange,
    tableHeaderClass,
    readOnly,
    isMedical,
    shouldShowPatient,
}) => {
    const [activeTab, setActiveTab] = useState<'upc' | 'no-upc' | 'all'>('all');
    const [printMode, setPrintMode] = useState<PrintMode>('all');
    const [showPrintMenu, setShowPrintMenu] = useState(false);
    const printMenuRef = useRef<HTMLDivElement>(null);

    // Close menu on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (printMenuRef.current && !printMenuRef.current.contains(e.target as Node)) {
                setShowPrintMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Split beds into UPC and Non-UPC
    const upcBeds = visibleBeds.filter(b => record.beds[b.id]?.isUPC);
    const nonUpcBeds = visibleBeds.filter(b => !record.beds[b.id]?.isUPC);

    const upcPatientCount = upcBeds.filter(b => record.beds[b.id]?.patientName).length;
    const nonUpcPatientCount = nonUpcBeds.filter(b => record.beds[b.id]?.patientName).length;

    // Determine which beds to display based on active tab
    const getDisplayBeds = () => {
        switch (activeTab) {
            case 'upc': return upcBeds;
            case 'no-upc': return nonUpcBeds;
            default: return visibleBeds;
        }
    };

    const displayBeds = getDisplayBeds();
    const hasDisplayPatients = displayBeds.some(b => record.beds[b.id]?.patientName);

    // Handle print with selected mode
    const handlePrint = (mode: PrintMode) => {
        setPrintMode(mode);
        setShowPrintMenu(false);
        // Small delay to allow state to update before printing
        setTimeout(() => window.print(), 100);
    };

    // Get beds for print based on printMode
    const getPrintBeds = () => {
        switch (printMode) {
            case 'upc': return { upc: upcBeds, nonUpc: [] };
            case 'no-upc': return { upc: [], nonUpc: nonUpcBeds };
            default: return { upc: upcBeds, nonUpc: nonUpcBeds };
        }
    };

    const printBeds = getPrintBeds();

    return (
        <div className="space-y-3">
            {/* Tab Switcher + Print Menu */}
            <div className="flex items-center justify-between print:hidden">
                <div className="flex bg-slate-100 p-1 rounded-lg w-fit">
                    <button
                        onClick={() => setActiveTab('all')}
                        className={clsx(
                            "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                            activeTab === 'all'
                                ? "bg-white text-slate-800 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                        )}
                    >
                        Todos ({upcPatientCount + nonUpcPatientCount})
                    </button>
                    <button
                        onClick={() => setActiveTab('upc')}
                        className={clsx(
                            "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                            activeTab === 'upc'
                                ? "bg-red-100 text-red-700 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                        )}
                    >
                        🔴 UPC ({upcPatientCount})
                    </button>
                    <button
                        onClick={() => setActiveTab('no-upc')}
                        className={clsx(
                            "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                            activeTab === 'no-upc'
                                ? "bg-green-100 text-green-700 shadow-sm"
                                : "text-slate-500 hover:text-slate-700"
                        )}
                    >
                        🟢 No UPC ({nonUpcPatientCount})
                    </button>
                </div>

                {/* Print Dropdown Menu */}
                <div className="relative" ref={printMenuRef}>
                    <button
                        onClick={() => setShowPrintMenu(!showPrintMenu)}
                        className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium"
                    >
                        <Printer size={16} />
                        Imprimir
                        <ChevronDown size={14} className={clsx("transition-transform", showPrintMenu && "rotate-180")} />
                    </button>

                    {showPrintMenu && (
                        <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50 min-w-[180px]">
                            <button
                                onClick={() => handlePrint('all')}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-slate-50 flex items-center gap-2"
                            >
                                📋 Todos los pacientes
                            </button>
                            <button
                                onClick={() => handlePrint('upc')}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-red-50 text-red-700 flex items-center gap-2"
                            >
                                🔴 Solo UPC ({upcPatientCount})
                            </button>
                            <button
                                onClick={() => handlePrint('no-upc')}
                                className="w-full px-4 py-2 text-left text-sm hover:bg-green-50 text-green-700 flex items-center gap-2"
                            >
                                🟢 Solo No UPC ({nonUpcPatientCount})
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Active Tab Content (Screen View) */}
            <div className="print:hidden">
                <HandoffPatientTable
                    visibleBeds={displayBeds}
                    record={record}
                    noteField={noteField}
                    onNoteChange={onNoteChange}
                    tableHeaderClass={tableHeaderClass}
                    readOnly={readOnly}
                    isMedical={isMedical}
                    hasAnyPatients={hasDisplayPatients}
                    shouldShowPatient={shouldShowPatient}
                />
            </div>

            {/* Print View - Shows based on printMode selection */}
            <div className="hidden print:block space-y-4">
                {/* UPC Section (Print) */}
                {printBeds.upc.length > 0 && printBeds.upc.some(b => record.beds[b.id]?.patientName) && (
                    <div>
                        <h3 className="text-xs font-bold text-red-700 bg-red-50 px-3 py-1 border border-red-200 border-b-0 rounded-t-lg">
                            🔴 PACIENTES UPC ({printBeds.upc.filter(b => record.beds[b.id]?.patientName).length})
                        </h3>
                        <HandoffPatientTable
                            visibleBeds={printBeds.upc}
                            record={record}
                            noteField={noteField}
                            onNoteChange={onNoteChange}
                            tableHeaderClass={tableHeaderClass}
                            readOnly={readOnly}
                            isMedical={isMedical}
                            hasAnyPatients={true}
                            shouldShowPatient={shouldShowPatient}
                        />
                    </div>
                )}

                {/* Non-UPC Section (Print) */}
                {printBeds.nonUpc.length > 0 && printBeds.nonUpc.some(b => record.beds[b.id]?.patientName) && (
                    <div>
                        <h3 className="text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1 border border-slate-200 border-b-0 rounded-t-lg">
                            🟢 PACIENTES NO UPC ({printBeds.nonUpc.filter(b => record.beds[b.id]?.patientName).length})
                        </h3>
                        <HandoffPatientTable
                            visibleBeds={printBeds.nonUpc}
                            record={record}
                            noteField={noteField}
                            onNoteChange={onNoteChange}
                            tableHeaderClass={tableHeaderClass}
                            readOnly={readOnly}
                            isMedical={isMedical}
                            hasAnyPatients={true}
                            shouldShowPatient={shouldShowPatient}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

