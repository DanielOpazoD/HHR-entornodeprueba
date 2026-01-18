import React from 'react';
import { CudyrScore, PatientData, BedDefinition } from '@/types';
import { getCategorization } from './CudyrScoreUtils';
import clsx from 'clsx';

interface CudyrRowProps {
    bed: BedDefinition;
    patient: PatientData;
    onScoreChange: (bedId: string, field: keyof CudyrScore, value: number) => void;
    readOnly?: boolean;
    isCrib?: boolean;
}

// Reusable Header Cell for Vertical Text
export const VerticalHeader = ({ text, colorClass }: { text: string, colorClass: string }) => (
    <th className={clsx("border border-slate-300 p-0 w-6 align-bottom h-44 relative print:h-24 print:bg-white", colorClass)}>
        <div className="h-full w-full flex items-center justify-center overflow-hidden">
            <span
                className="block whitespace-nowrap text-[10px] font-bold leading-none tracking-tight uppercase print:text-[5px] print:transform-none"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
                {text}
            </span>
        </div>
    </th>
);

const ScoreInput: React.FC<{
    bedId: string;
    field: keyof CudyrScore;
    value?: number;
    onScoreChange: (bedId: string, field: keyof CudyrScore, value: number) => void;
    readOnly?: boolean;
}> = ({ bedId, field, value, onScoreChange, readOnly }) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const valStr = e.target.value;
        if (valStr === '') {
            onScoreChange(bedId, field, 0);
            return;
        }
        const num = parseInt(valStr);
        if (!isNaN(num) && num >= 0 && num <= 3) {
            onScoreChange(bedId, field, num);
        }
    };

    return (
        <input
            type="number"
            min="0"
            max="3"
            className={clsx(
                "w-full h-full text-center bg-transparent border-0 p-1 text-xs focus:ring-2 focus:ring-inset focus:ring-blue-500 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-medium",
                readOnly && "cursor-not-allowed opacity-60"
            )}
            value={value ?? ''}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            onChange={handleChange}
            disabled={readOnly}
        />
    );
};

export const CudyrRow: React.FC<CudyrRowProps> = ({ bed, patient, onScoreChange, readOnly = false, isCrib = false }) => {
    const isOccupied = !!patient?.patientName;
    const isUTI = bed.type === 'UTI';
    const cudyrScores = patient?.cudyr;

    const { finalCat, depScore, riskScore, badgeColor } = getCategorization(patient?.cudyr);

    // Background color based on bed type and crib status
    const rowBgClass = isCrib
        ? "bg-purple-50/60"
        : isUTI
            ? "bg-yellow-50/60"
            : "bg-white";

    if (!isOccupied) {
        return (
            <tr className={clsx("border-b border-slate-300 hover:bg-slate-100 transition-colors", rowBgClass)}>
                <td className={clsx("border-r border-slate-300 p-1 text-center font-bold", isCrib ? "text-purple-700" : "text-slate-700")}>{bed.name}</td>
                <td colSpan={17} className="p-2 text-center text-slate-400 italic text-[10px]">
                    {isCrib ? "Cuna clínica sin paciente" : "Cama disponible"}
                </td>
            </tr>
        );
    }

    return (
        <tr className={clsx("border-b border-slate-300 hover:bg-slate-100 transition-colors", rowBgClass)}>
            <td className={clsx("border-r border-slate-300 p-1 text-center font-bold", isCrib ? "text-purple-700" : "text-slate-700")}>{bed.name}</td>
            <td className="border-r border-slate-300 p-1 truncate font-medium text-slate-700 w-[100px] max-w-[100px] print:w-[88px] print:max-w-[88px] print:whitespace-nowrap print:overflow-visible" title={patient.patientName}>
                {/* Show name on screen, RUT when printing */}
                <span className="print:hidden">{patient.patientName}</span>
                <span className="hidden print:inline text-[10px]">{patient.rut || '-'}</span>
            </td>

            {/* Dependency Inputs */}
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
                <ScoreInput bedId={bed.id} field="changeClothes" value={cudyrScores?.changeClothes} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
                <ScoreInput bedId={bed.id} field="mobilization" value={cudyrScores?.mobilization} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
                <ScoreInput bedId={bed.id} field="feeding" value={cudyrScores?.feeding} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
                <ScoreInput bedId={bed.id} field="elimination" value={cudyrScores?.elimination} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
                <ScoreInput bedId={bed.id} field="psychosocial" value={cudyrScores?.psychosocial} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-blue-50">
                <ScoreInput bedId={bed.id} field="surveillance" value={cudyrScores?.surveillance} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>

            {/* Risk Inputs */}
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
                <ScoreInput bedId={bed.id} field="vitalSigns" value={cudyrScores?.vitalSigns} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
                <ScoreInput bedId={bed.id} field="fluidBalance" value={cudyrScores?.fluidBalance} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
                <ScoreInput bedId={bed.id} field="oxygenTherapy" value={cudyrScores?.oxygenTherapy} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
                <ScoreInput bedId={bed.id} field="airway" value={cudyrScores?.airway} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
                <ScoreInput bedId={bed.id} field="proInterventions" value={cudyrScores?.proInterventions} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
                <ScoreInput bedId={bed.id} field="skinCare" value={cudyrScores?.skinCare} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
                <ScoreInput bedId={bed.id} field="pharmacology" value={cudyrScores?.pharmacology} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>
            <td className="border-r border-slate-300 p-0 text-center bg-white hover:bg-red-50">
                <ScoreInput bedId={bed.id} field="invasiveElements" value={cudyrScores?.invasiveElements} onScoreChange={onScoreChange} readOnly={readOnly} />
            </td>

            {/* Results - P.DEP and P.RIES first (hidden on print), then CAT */}
            <td className="border-r border-slate-300 p-1 text-center text-xs text-blue-800 font-bold bg-blue-50/30 print:hidden">
                {depScore}
            </td>
            <td className="border-r border-slate-300 p-1 text-center text-xs text-red-800 font-bold bg-red-50/30 print:hidden">
                {riskScore}
            </td>
            <td className="p-1 text-center print:p-0.5">
                <span className={clsx("px-2 py-0.5 rounded font-bold text-xs block w-full shadow-sm print:px-1 print:text-[10px]", badgeColor)}>
                    {finalCat}
                </span>
            </td>
        </tr>
    );
};
