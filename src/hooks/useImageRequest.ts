/**
 * useImageRequest Hook
 * Manages state and logic for the imaging request form and TAC survey.
 */

import { useState, useCallback, useEffect } from 'react';
import { PatientData } from '@/types';


interface UseImageRequestParams {
    patient: PatientData;
    isOpen?: boolean;
}

export interface SurveyData {
    telefono: string;
    peso: string;
    medicoTratante: string;
    procedencia: 'Urgencia' | 'Hospitalizados' | 'Policlínico';
    diagnostico: string;
    operado: 'Si' | 'No';
    operadoDetalles: string;
    enfermedades: string[];
    enfermedadesOtras: string;
    creatinina: 'Si' | 'No';
    alergias: 'Si' | 'No';
    alergiasCuales: string;
    examenesAnterioresContraste: 'Si' | 'No';
    reaccionAdversaContraste: 'Si' | 'No';
    premedicacion: 'Si' | 'No';
    horasAyuno: string;
}

interface UseImageRequestReturn {
    // General State
    selectedExams: Set<string>;
    contrastMode: Record<string, 'CON CONTRASTE' | 'SIN CONTRASTE'>;
    procedencia: string;
    prevision: string;

    // Survey State
    survey: SurveyData;
    manualValues: Record<string, string>;

    // Setters
    setProcedencia: (value: string) => void;
    setPrevision: (value: string) => void;
    updateSurvey: <K extends keyof SurveyData>(field: K, value: SurveyData[K]) => void;
    updateManualValue: (fieldId: string, value: string) => void;
    toggleEnfermedad: (enfermedad: string) => void;

    // Actions
    toggleExam: (examKey: string) => void;
    setContrast: (examKey: string, mode: 'CON CONTRASTE' | 'SIN CONTRASTE') => void;
    handlePrintSolicitud: () => void;
    handlePrintEncuesta: () => void;
}

export const useImageRequest = ({ patient, isOpen }: UseImageRequestParams): UseImageRequestReturn => {
    const [selectedExams, setSelectedExams] = useState<Set<string>>(new Set());
    const [contrastMode, setContrastMode] = useState<Record<string, 'CON CONTRASTE' | 'SIN CONTRASTE'>>({});
    const [procedencia, setProcedencia] = useState('Hospitalizados');
    const [prevision, setPrevision] = useState(() => patient.insurance || 'FONASA');

    const [survey, setSurvey] = useState<SurveyData>({
        telefono: '',
        peso: '',
        medicoTratante: '',
        procedencia: 'Hospitalizados',
        diagnostico: patient.pathology || '',
        operado: 'No',
        operadoDetalles: '',
        enfermedades: [],
        enfermedadesOtras: '',
        creatinina: 'No',
        alergias: 'No',
        alergiasCuales: '',
        examenesAnterioresContraste: 'No',
        reaccionAdversaContraste: 'No',
        premedicacion: 'No',
        horasAyuno: '',
    });

    const [manualValues, setManualValues] = useState<Record<string, string>>({});

    // Reset when modal opens - use timeout to avoid cascading render warning
    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => {
                setSelectedExams(new Set());
                setContrastMode({});
                setProcedencia('Hospitalizados');
                setPrevision(patient.insurance || 'FONASA');
                setSurvey(prev => ({
                    ...prev,
                    diagnostico: patient.pathology || '',
                    procedencia: 'Hospitalizados'
                }));
                setManualValues({});
            }, 0);
            return () => clearTimeout(timer);
        }
    }, [isOpen, patient.insurance, patient.pathology]);

    const toggleExam = useCallback((examKey: string) => {
        setSelectedExams(prev => {
            const next = new Set(prev);
            if (next.has(examKey)) {
                next.delete(examKey);
            } else {
                next.add(examKey);
            }
            return next;
        });
    }, []);

    const setContrast = useCallback((examKey: string, mode: 'CON CONTRASTE' | 'SIN CONTRASTE') => {
        setContrastMode(prev => ({
            ...prev,
            [examKey]: mode
        }));
    }, []);

    const updateSurvey = useCallback(<K extends keyof SurveyData>(field: K, value: SurveyData[K]) => {
        setSurvey(prev => ({
            ...prev,
            [field]: value
        }));
    }, []);

    const updateManualValue = useCallback((fieldId: string, value: string) => {
        setManualValues(prev => ({
            ...prev,
            [fieldId]: value
        }));
    }, []);

    const toggleEnfermedad = useCallback((enfermedad: string) => {
        setSurvey(prev => {
            const index = prev.enfermedades.indexOf(enfermedad);
            const next = [...prev.enfermedades];
            if (index > -1) {
                next.splice(index, 1);
            } else {
                next.push(enfermedad);
            }
            return { ...prev, enfermedades: next };
        });
    }, []);

    const handleGenericPrint = useCallback((printTitle: string) => {
        const originalTitle = document.title;
        document.title = printTitle;

        window.print();

        setTimeout(() => {
            document.title = originalTitle;
        }, 1000);
    }, []);

    const handlePrintSolicitud = useCallback(() => {
        handleGenericPrint('SOLICITUD DE IMAGENOLOGÍA');
    }, [handleGenericPrint]);

    const handlePrintEncuesta = useCallback(() => {
        handleGenericPrint('ENCUESTA DE CONTRASTE');
    }, [handleGenericPrint]);

    return {
        selectedExams,
        contrastMode,
        procedencia,
        prevision,
        survey,
        manualValues,
        setProcedencia,
        setPrevision,
        updateSurvey,
        updateManualValue,
        toggleEnfermedad,
        toggleExam,
        setContrast,
        handlePrintSolicitud,
        handlePrintEncuesta
    };
};
