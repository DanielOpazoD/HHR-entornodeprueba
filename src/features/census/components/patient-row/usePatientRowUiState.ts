import { useCallback, useState } from 'react';

interface UsePatientRowUiStateResult {
    showDemographics: boolean;
    showExamRequest: boolean;
    showHistory: boolean;
    openDemographics: () => void;
    closeDemographics: () => void;
    openExamRequest: () => void;
    closeExamRequest: () => void;
    openHistory: () => void;
    closeHistory: () => void;
}

export const usePatientRowUiState = (): UsePatientRowUiStateResult => {
    const [showDemographics, setShowDemographics] = useState(false);
    const [showExamRequest, setShowExamRequest] = useState(false);
    const [showHistory, setShowHistory] = useState(false);

    const openDemographics = useCallback(() => setShowDemographics(true), []);
    const closeDemographics = useCallback(() => setShowDemographics(false), []);
    const openExamRequest = useCallback(() => setShowExamRequest(true), []);
    const closeExamRequest = useCallback(() => setShowExamRequest(false), []);
    const openHistory = useCallback(() => setShowHistory(true), []);
    const closeHistory = useCallback(() => setShowHistory(false), []);

    return {
        showDemographics,
        showExamRequest,
        showHistory,
        openDemographics,
        closeDemographics,
        openExamRequest,
        closeExamRequest,
        openHistory,
        closeHistory
    };
};
