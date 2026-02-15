import type { DiagnosisMode } from '@/features/census/types/censusTableTypes';

export interface DiagnosisToggleUiState {
    isCie10Mode: boolean;
    title: string;
    buttonClassName: string;
}

const CIE10_TITLE = 'Modo CIE-10 (clic para cambiar a texto libre)';
const FREE_TEXT_TITLE = 'Modo texto libre (clic para cambiar a CIE-10)';

const CIE10_BUTTON_CLASS =
    'bg-medical-600 text-white';

const FREE_TEXT_BUTTON_CLASS =
    'bg-white border border-slate-300 text-slate-400 hover:text-medical-600';

export const resolveDiagnosisToggleUiState = (
    diagnosisMode: DiagnosisMode
): DiagnosisToggleUiState => {
    const isCie10Mode = diagnosisMode === 'cie10';

    return {
        isCie10Mode,
        title: isCie10Mode ? CIE10_TITLE : FREE_TEXT_TITLE,
        buttonClassName: isCie10Mode ? CIE10_BUTTON_CLASS : FREE_TEXT_BUTTON_CLASS
    };
};
