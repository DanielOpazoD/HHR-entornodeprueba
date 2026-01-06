/**
 * Transfer Questionnaire Modal
 * Dynamic form for collecting transfer-specific information based on hospital configuration
 */

import React, { useState, useMemo, useCallback } from 'react';
import { X, ChevronRight, ChevronLeft, Check, FileDown } from 'lucide-react';
import {
    HospitalConfig,
    TransferQuestion,
    QuestionResponse,
    QuestionnaireResponse,
    TransferPatientData
} from '@/types/transferDocuments';
import { questionGroups } from '@/constants/hospitalConfigs';
import clsx from 'clsx';

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

        // Filter out empty groups
        return Object.fromEntries(
            Object.entries(groups).filter(([, qs]) => qs.length > 0)
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

    const currentGroup = groupKeys[currentGroupIndex];
    const currentQuestions = groupedQuestions[currentGroup] || [];
    const groupInfo = questionGroups[currentGroup as keyof typeof questionGroups] || { label: currentGroup, icon: 'FileText' };

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

    // Navigation
    const canGoBack = currentGroupIndex > 0;
    const canGoNext = currentGroupIndex < groupKeys.length - 1;
    const isLastGroup = currentGroupIndex === groupKeys.length - 1;

    const handleNext = () => {
        if (canGoNext) {
            setCurrentGroupIndex(prev => prev + 1);
        }
    };

    const handleBack = () => {
        if (canGoBack) {
            setCurrentGroupIndex(prev => prev - 1);
        }
    };

    const handleComplete = () => {
        const responseArray: QuestionResponse[] = Object.entries(responses).map(([questionId, value]) => ({
            questionId,
            value
        }));

        onComplete({
            responses: responseArray,
            completedAt: new Date().toISOString(),
            completedBy: 'current-user' // TODO: Get from auth context
        });
    };

    // Validate current group
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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-600 to-blue-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold text-white">
                                Datos para Traslado
                            </h2>
                            <p className="text-blue-100 text-sm mt-1">
                                {hospital.name} • {patientData.patientName}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 rounded-full hover:bg-white/20 transition-colors"
                        >
                            <X size={20} className="text-white" />
                        </button>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-4 flex items-center gap-2">
                        {groupKeys.map((group, index) => (
                            <div
                                key={group}
                                className={clsx(
                                    "h-1.5 flex-1 rounded-full transition-colors",
                                    index <= currentGroupIndex ? "bg-white" : "bg-white/30"
                                )}
                            />
                        ))}
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* Group Title */}
                    <div className="mb-6 pb-4 border-b border-slate-100">
                        <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">
                            Documento {currentGroupIndex + 1} de {groupKeys.length}
                        </p>
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <span className="bg-blue-50 text-blue-700 p-1.5 rounded-lg">
                                {/* Dynamic icon could go here if needed */}
                                <FileDown size={20} />
                            </span>
                            {groupInfo.label}
                        </h3>
                        <p className="text-sm text-slate-500 mt-2">
                            Por favor complete los campos requeridos para esta plantilla.
                        </p>
                    </div>

                    {/* Questions */}
                    <div className="space-y-6">
                        {visibleQuestions.map(question => (
                            <QuestionInput
                                key={question.id}
                                question={question}
                                value={responses[question.id]}
                                onChange={(value) => handleChange(question.id, value)}
                            />
                        ))}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                    <button
                        onClick={handleBack}
                        disabled={!canGoBack}
                        className={clsx(
                            "flex items-center gap-2 px-4 py-2 rounded-lg transition-colors",
                            canGoBack
                                ? "text-slate-700 hover:bg-slate-200"
                                : "text-slate-300 cursor-not-allowed"
                        )}
                    >
                        <ChevronLeft size={18} />
                        Anterior
                    </button>

                    {isLastGroup ? (
                        <button
                            onClick={handleComplete}
                            disabled={!isCurrentGroupValid}
                            className={clsx(
                                "flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors",
                                isCurrentGroupValid
                                    ? "bg-green-600 text-white hover:bg-green-700"
                                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                            )}
                        >
                            <FileDown size={18} />
                            Generar Documentos
                        </button>
                    ) : (
                        <button
                            onClick={handleNext}
                            disabled={!isCurrentGroupValid}
                            className={clsx(
                                "flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors",
                                isCurrentGroupValid
                                    ? "bg-blue-600 text-white hover:bg-blue-700"
                                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                            )}
                        >
                            Siguiente
                            <ChevronRight size={18} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// Question Input Component
// ============================================================================

interface QuestionInputProps {
    question: TransferQuestion;
    value: QuestionResponse['value'];
    onChange: (value: QuestionResponse['value']) => void;
}

const QuestionInput: React.FC<QuestionInputProps> = ({ question, value, onChange }) => {
    // Get options
    const getOptions = (): string[] => {
        if (question.options) return question.options;
        return [];
    };

    const options = getOptions();

    const baseInputClass = "w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors";

    switch (question.type) {
        case 'boolean':
            return (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                        {question.label}
                        {question.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={() => onChange(true)}
                            className={clsx(
                                "flex-1 py-2.5 rounded-lg border-2 font-medium transition-all",
                                value === true
                                    ? "border-green-500 bg-green-50 text-green-700"
                                    : "border-slate-200 text-slate-600 hover:border-green-300"
                            )}
                        >
                            <div className="flex items-center justify-center gap-2">
                                {value === true && <Check size={16} />}
                                Sí
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => onChange(false)}
                            className={clsx(
                                "flex-1 py-2.5 rounded-lg border-2 font-medium transition-all",
                                value === false
                                    ? "border-red-500 bg-red-50 text-red-700"
                                    : "border-slate-200 text-slate-600 hover:border-red-300"
                            )}
                        >
                            <div className="flex items-center justify-center gap-2">
                                {value === false && <X size={16} />}
                                No
                            </div>
                        </button>
                    </div>
                    {question.helpText && (
                        <p className="text-xs text-slate-500">{question.helpText}</p>
                    )}
                </div>
            );

        case 'select':
            return (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                        {question.label}
                        {question.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <select
                        value={(value as string) || ''}
                        onChange={(e) => onChange(e.target.value)}
                        className={baseInputClass}
                    >
                        <option value="">Seleccione...</option>
                        {options.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                </div>
            );

        case 'multiselect':
            const selectedValues = (value as string[]) || [];
            return (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                        {question.label}
                        {question.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <div className="flex flex-wrap gap-2">
                        {options.map(opt => {
                            const isSelected = selectedValues.includes(opt);
                            return (
                                <button
                                    key={opt}
                                    type="button"
                                    onClick={() => {
                                        if (isSelected) {
                                            onChange(selectedValues.filter(v => v !== opt));
                                        } else {
                                            onChange([...selectedValues, opt]);
                                        }
                                    }}
                                    className={clsx(
                                        "px-3 py-1.5 rounded-full text-sm font-medium transition-all border",
                                        isSelected
                                            ? "border-blue-500 bg-blue-50 text-blue-700"
                                            : "border-slate-200 text-slate-600 hover:border-blue-300"
                                    )}
                                >
                                    {isSelected && <Check size={14} className="inline mr-1" />}
                                    {opt}
                                </button>
                            );
                        })}
                    </div>
                </div>
            );

        case 'textarea':
            return (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                        {question.label}
                        {question.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <textarea
                        value={(value as string) || ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={question.placeholder}
                        rows={3}
                        className={baseInputClass + " resize-none"}
                    />
                </div>
            );

        case 'time':
            return (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                        {question.label}
                        {question.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <input
                        type="time"
                        value={(value as string) || ''}
                        onChange={(e) => onChange(e.target.value)}
                        className={baseInputClass}
                    />
                </div>
            );

        case 'phone':
            return (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                        {question.label}
                        {question.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <input
                        type="tel"
                        value={(value as string) || ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={question.placeholder || '+56 9 ...'}
                        className={baseInputClass}
                    />
                </div>
            );

        case 'text':
        default:
            return (
                <div className="space-y-2">
                    <label className="block text-sm font-medium text-slate-700">
                        {question.label}
                        {question.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    <input
                        type="text"
                        value={(value as string) || ''}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={question.placeholder}
                        className={baseInputClass}
                    />
                    {question.helpText && (
                        <p className="text-xs text-slate-500">{question.helpText}</p>
                    )}
                </div>
            );
    }
};

export default TransferQuestionnaireModal;
