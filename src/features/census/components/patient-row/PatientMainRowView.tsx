import React from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';
import clsx from 'clsx';
import { BedDefinition, BedType, PatientData } from '@/types';
import { DiagnosisMode } from '@/features/census/components/CensusTable';
import { MedicalBadge } from '@/components/ui/base/MedicalBadge';
import { isIntensiveBedType } from '@/utils/bedTypeUtils';
import { PatientActionMenu } from './PatientActionMenu';
import { PatientBedConfig } from './PatientBedConfig';
import { PatientInputCells } from './PatientInputCells';
import { shouldShowBedTypeToggle } from '@/features/census/controllers/patientRowMainViewController';
import type { PatientInputChangeHandlers } from './inputCellTypes';
import type {
    PatientActionMenuCallbacks,
    PatientBedConfigCallbacks,
    RowMenuAlign
} from './patientRowContracts';

interface PatientMainRowViewProps extends Omit<PatientActionMenuCallbacks, 'onViewDemographics' | 'onViewExamRequest' | 'onViewHistory'>, Omit<PatientBedConfigCallbacks, 'onShowCribDemographics'> {
    bed: BedDefinition;
    bedType: BedType;
    data: PatientData;
    currentDateString: string;
    style?: React.CSSProperties;
    readOnly: boolean;
    actionMenuAlign: RowMenuAlign;
    diagnosisMode: DiagnosisMode;
    isBlocked: boolean;
    isEmpty: boolean;
    hasCompanion: boolean;
    hasClinicalCrib: boolean;
    isCunaMode: boolean;
    onOpenDemographics: () => void;
    onOpenExamRequest: () => void;
    onOpenHistory: () => void;
    onToggleBedType: () => void;
    onChange: PatientInputChangeHandlers;
}

export const PatientMainRowView: React.FC<PatientMainRowViewProps> = ({
    bed,
    bedType,
    data,
    currentDateString,
    style,
    readOnly,
    actionMenuAlign,
    diagnosisMode,
    isBlocked,
    isEmpty,
    hasCompanion,
    hasClinicalCrib,
    isCunaMode,
    onAction,
    onOpenDemographics,
    onOpenExamRequest,
    onOpenHistory,
    onToggleMode,
    onToggleCompanion,
    onToggleClinicalCrib,
    onToggleBedType,
    onUpdateClinicalCrib,
    onChange
}) => {
    const canToggleBedType = shouldShowBedTypeToggle({
        bedId: bed.id,
        readOnly,
        isEmpty
    });

    return (
        <tr
            className={clsx(
                "group/row relative border-b border-slate-100 transition-all duration-200 ease-in-out",
                "hover:bg-slate-50 hover:shadow-sm hover:z-10",
                isBlocked ? "bg-slate-50/50" : "bg-white",
                "text-[12px] leading-tight",
                data.patientName?.trim() === '' && "animate-slide-fade-in"
            )}
            style={style}
            data-testid="patient-row"
            data-bed-id={bed.id}
        >
            <td className="p-0 text-center border-r border-slate-200 relative w-10 print:hidden">
                <PatientActionMenu
                    isBlocked={isBlocked}
                    onAction={onAction}
                    onViewDemographics={onOpenDemographics}
                    onViewExamRequest={data.patientName ? onOpenExamRequest : undefined}
                    onViewHistory={data.rut ? onOpenHistory : undefined}
                    readOnly={readOnly}
                    align={actionMenuAlign}
                />
            </td>

            <PatientBedConfig
                bed={bed}
                data={data}
                currentDateString={currentDateString}
                isBlocked={isBlocked}
                hasCompanion={hasCompanion}
                hasClinicalCrib={hasClinicalCrib}
                isCunaMode={isCunaMode}
                onToggleMode={onToggleMode}
                onToggleCompanion={onToggleCompanion}
                onToggleClinicalCrib={onToggleClinicalCrib}
                onTextChange={onChange.text}
                onUpdateClinicalCrib={onUpdateClinicalCrib}
                onShowCribDemographics={() => { }}
                readOnly={readOnly}
                align={actionMenuAlign}
            />

            <td className="p-0 border-r border-slate-100 text-center w-16 relative group/tipo-cell">
                <div className="flex flex-col items-center gap-1 py-1">
                    <MedicalBadge
                        variant={isIntensiveBedType(bedType) ? 'pink' : 'blue'}
                        className="w-10 justify-center mx-auto"
                    >
                        {bedType}
                    </MedicalBadge>
                </div>
                {canToggleBedType && (
                    <button
                        onClick={onToggleBedType}
                        className="absolute top-0.5 right-0.5 p-0.5 rounded-full text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition-all opacity-0 group-hover/tipo-cell:opacity-100"
                        title="Cambiar nivel de cuidado (UCI/UTI)"
                    >
                        <RefreshCcw size={10} className="animate-hover-spin" />
                    </button>
                )}
            </td>

            {isBlocked ? (
                <td colSpan={10} className="p-1 bg-slate-50/50 text-center">
                    <div className="text-slate-400 text-sm flex items-center justify-center gap-2 italic">
                        <AlertCircle size={14} className="text-red-300/60" />
                        <span>Cama Bloqueada</span>
                        {data.blockedReason && <span className="text-xs opacity-70">({data.blockedReason})</span>}
                    </div>
                </td>
            ) : (
                <PatientInputCells
                    data={data}
                    currentDateString={currentDateString}
                    isEmpty={isEmpty}
                    onChange={onChange}
                    onDemo={onOpenDemographics}
                    readOnly={readOnly}
                    diagnosisMode={diagnosisMode}
                />
            )}
        </tr>
    );
};
