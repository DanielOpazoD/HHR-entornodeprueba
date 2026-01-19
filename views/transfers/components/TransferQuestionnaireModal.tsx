/**
 * Transfer Questionnaire Modal
 * Dynamic form for collecting transfer-specific information based on hospital configuration
 */

import React, { useState, useMemo, useCallback } from 'react';
import { X, Check, FileDown } from 'lucide-react';
import {
    HospitalConfig,
    TransferQuestion,
    QuestionResponse,
    QuestionnaireResponse,
    TransferPatientData
} from '@/types/transferDocuments';
import { questionGroups } from '@/constants/hospitalConfigs';
import clsx from 'clsx';
// import { useAuth } from '@/context/AuthContext';
import { QuestionInput } from './QuestionInput';

interface TransferQuestionnaireModalProps {
    isOpen: boolean;
    onClose: () => void;
    hospital: HospitalConfig;
    patientData: TransferPatientData;
    initialResponses?: QuestionnaireResponse;
    onComplete: (responses: QuestionnaireResponse) => void;
}

export const TransferQuestionnaireModal: React.FC<TransferQuestionnaireModalProps> = ({
    isOpen,
    onClose,
    hospital,
    patientData,
    initialResponses,
    onComplete
}) => {
    // Get current user for completedBy field (if needed in future)
    // const { user } = useAuth();

    // Group questions by category (templates)
    const groupedQuestions = useMemo(() => {
        const groups: Record<string, TransferQuestion[]> = {};

        // Ensure groups are in order of templates
        hospital.templates.forEach(t => {
            if (t.enabled) {
                groups[t.id] = [];
            }
        });

        hospital.questions.forEach(q => {
            const group = q.group || 'general';
            if (!groups[group]) groups[group] = [];
            groups[group].push(q);
        });

        // Filter out empty groups and specifically hide ambulance request from questionnaire visibility
        // as requested by user (it will still be generated in background)
        return Object.fromEntries(
            Object.entries(groups).filter(([key, qs]) => qs.length > 0 && key !== 'solicitud-ambulancia')
        );
    }, [hospital.questions, hospital.templates]);

    const groupKeys = Object.keys(groupedQuestions);
    const [currentGroupIndex, setCurrentGroupIndex] = useState(0);
    const [responses, setResponses] = useState<Record<string, QuestionResponse['value']>>(() => {
        const initial: Record<string, QuestionResponse['value']> = {};

        // 1. Set defaults from config
        hospital.questions.forEach(q => {
            if (q.defaultValue !== undefined) {
                initial[q.id] = q.defaultValue;
            }
        });

        // 2. Override with saved responses if available
        if (initialResponses?.responses) {
            initialResponses.responses.forEach(r => {
                initial[r.questionId] = r.value;
            });
        }

        return initial;
    });

    // Nurse name for documents - must be filled manually
    const [nurseName, setNurseName] = useState<string>(
        initialResponses?.completedBy || ''
    );

    // Attending Physician
    const [attendingPhysician, setAttendingPhysician] = useState<string>(
        initialResponses?.attendingPhysician || ''
    );

    // Diagnosis (initialize from patientData.diagnosis if not in initialResponses)
    const [diagnosis, setDiagnosis] = useState<string>(
        initialResponses?.diagnosis || patientData.diagnosis || ''
    );

    const currentGroup = groupKeys[currentGroupIndex];
    const currentQuestions = groupedQuestions[currentGroup] || [];
    // const groupInfo = questionGroups[currentGroup as keyof typeof questionGroups] || { label: currentGroup, icon: 'FileText' };

    // Check if a question should be visible based on showIf condition
    const isQuestionVisible = useCallback((question: TransferQuestion): boolean => {
        if (!question.showIf) return true;
        const dependentValue = responses[question.showIf.questionId];
        return dependentValue === question.showIf.value;
    }, [responses]);

    const visibleQuestions = currentQuestions.filter(isQuestionVisible);

    // Handle response changes
    const handleChange = (questionId: string, value: QuestionResponse['value']) => {
        setResponses(prev => ({ ...prev, [questionId]: value }));
    };

    // Navigation state (currently managed by UI buttons directly iterating)
    // const canGoBack = currentGroupIndex > 0;
    // const canGoNext = currentGroupIndex < groupKeys.length - 1;

    const handleComplete = () => {
        const responseArray: QuestionResponse[] = Object.entries(responses).map(([questionId, value]) => ({
            questionId,
            value
        }));

        onComplete({
            responses: responseArray,
            completedAt: new Date().toISOString(),
            completedBy: nurseName.trim() || 'Enfermero/a de Turno',
            attendingPhysician: attendingPhysician.trim(),
            diagnosis: diagnosis.trim()
        });
    };

    // Validate current group
    /*
    const isCurrentGroupValid = useMemo(() => {
        return visibleQuestions
            .filter(q => q.required)
            .every(q => {
                const value = responses[q.id];
                if (value === undefined || value === null || value === '') return false;
                if (Array.isArray(value) && value.length === 0) return false;
                return true;
            });
    }, [visibleQuestions, responses]);
    */

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-md p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 bg-white">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                <FileDown size={18} />
                            </div>
                            <div>
                                <h2 className="text-base font-bold text-slate-800">
                                    Configuración de Documentos
                                </h2>
                                <p className="text-slate-500 text-[10px]">
                                    {hospital.name} • <span className="text-blue-600 font-medium">{patientData.patientName}</span>
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {/* Compact Initial Fields */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                        <div>
                            <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">
                                Enfermero/a de Turno
                            </label>
                            <input
                                type="text"
                                value={nurseName}
                                onChange={(e) => setNurseName(e.target.value)}
                                placeholder="Nombre completo"
                                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">
                                Médico Tratante
                            </label>
                            <input
                                type="text"
                                value={attendingPhysician}
                                onChange={(e) => setAttendingPhysician(e.target.value)}
                                placeholder="Nombre del Médico"
                                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-1">
                                Diagnóstico Principal
                            </label>
                            <input
                                type="text"
                                value={diagnosis}
                                onChange={(e) => setDiagnosis(e.target.value)}
                                placeholder="Diagnóstico principal"
                                className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 text-xs focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                            />
                        </div>
                    </div>

                    {/* Navigation Tabs */}
                    <div className="mt-4 flex items-center gap-1 p-1 bg-slate-100/50 rounded-lg w-fit">
                        {groupKeys.map((group, index) => {
                            const info = questionGroups[group as keyof typeof questionGroups] || { label: group };
                            const isActive = index === currentGroupIndex;
                            return (
                                <button
                                    key={group}
                                    onClick={() => setCurrentGroupIndex(index)}
                                    className={clsx(
                                        "px-3 py-1.5 rounded text-[10px] font-bold transition-all flex items-center gap-1.5",
                                        isActive
                                            ? "bg-white text-blue-600 shadow-sm border border-slate-200/50"
                                            : "text-slate-500 hover:text-slate-800 hover:bg-white/50"
                                    )}
                                >
                                    {isActive && <div className="w-1 h-1 rounded-full bg-blue-500" />}
                                    {info.label.toUpperCase()}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {/* Redundant title removed as per user request */}
                    <div className="mb-5"></div>

                    {/* Questions Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                        {visibleQuestions.map(question => (
                            <div key={question.id} className={clsx(
                                question.type === 'textarea' || question.type === 'multiselect' ? "md:col-span-2" : ""
                            )}>
                                <QuestionInput
                                    question={question}
                                    value={responses[question.id]}
                                    onChange={(value) => handleChange(question.id, value)}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-8 py-5 border-t border-slate-100 bg-white flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                            <Check size={16} />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Responsable</p>
                            <p className="text-sm font-semibold text-slate-700">
                                {nurseName.trim() || 'No asignado'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleComplete}
                            disabled={!nurseName.trim()}
                            className={clsx(
                                "flex items-center gap-2 px-8 py-2.5 rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-500/10",
                                nurseName.trim()
                                    ? "bg-slate-900 text-white hover:bg-slate-800"
                                    : "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none"
                            )}
                        >
                            <FileDown size={18} />
                            Generar y Editar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TransferQuestionnaireModal;
