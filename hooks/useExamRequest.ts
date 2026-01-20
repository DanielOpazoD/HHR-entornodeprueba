/**
 * useExamRequest Hook
 * Manages state and logic for the laboratory exam request form.
 */

import { useState, useCallback } from 'react';
import { PatientData } from '@/types';

interface UseExamRequestParams {
    patient: PatientData;
    isOpen: boolean;
}

interface UseExamRequestReturn {
    // State
    selectedExams: Set<string>;
    procedencia: string;
    prevision: string;

    // Setters
    setProcedencia: (value: string) => void;
    setPrevision: (value: string) => void;

    // Actions
    toggleExam: (examKey: string) => void;
    handlePrint: () => void;
    getSelectedCount: () => number;
}

export const useExamRequest = ({ patient, isOpen }: UseExamRequestParams): UseExamRequestReturn => {
    const [selectedExams, setSelectedExams] = useState<Set<string>>(new Set());
    const [procedencia, setProcedencia] = useState('Hospitalización');
    const [prevision, setPrevision] = useState(patient.insurance || 'FONASA');

    // State to track previous isOpen prop for resetting
    const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

    // Reset state when opening (Render Phase Update)
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) {
            setSelectedExams(new Set());
            setPrevision(patient.insurance || 'FONASA');
        }
    }

    const toggleExam = useCallback((examKey: string) => {
        setSelectedExams(prev => {
            const next = new Set(prev);
            if (next.has(examKey)) next.delete(examKey);
            else next.add(examKey);
            return next;
        });
    }, []);

    const handlePrint = useCallback(() => {
        const originalTitle = document.title;
        const modalTitleElement = document.getElementById('modal-title-text');
        const originalModalTitle = modalTitleElement?.innerText;

        // 1. Clear browser title
        document.title = ' ';

        // 2. Clear modal title in DOM directly
        if (modalTitleElement) {
            modalTitleElement.innerText = '';
        }

        setTimeout(() => {
            window.print();

            // 3. Restore everything
            setTimeout(() => {
                document.title = originalTitle;
                if (modalTitleElement && originalModalTitle) {
                    modalTitleElement.innerText = originalModalTitle;
                }
            }, 1000);
        }, 150);
    }, []);

    const getSelectedCount = useCallback(() => selectedExams.size, [selectedExams]);

    return {
        selectedExams,
        procedencia,
        prevision,
        setProcedencia,
        setPrevision,
        toggleExam,
        handlePrint,
        getSelectedCount
    };
};
