/**
 * Question Input Component
 * Renders different input types based on TransferQuestion configuration.
 * Supports: boolean, select, multiselect, textarea, time, phone, text
 */

import React from 'react';
import { Check, X } from 'lucide-react';
import { TransferQuestion, QuestionResponse } from '@/types/transferDocuments';
import clsx from 'clsx';

export interface QuestionInputProps {
    question: TransferQuestion;
    value: QuestionResponse['value'];
    onChange: (value: QuestionResponse['value']) => void;
}

const baseInputClass = "w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors text-sm";

// ============================================================================
// Boolean Input
// ============================================================================
const BooleanInput: React.FC<QuestionInputProps> = ({ question, value, onChange }) => (
    <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-600">
            {question.label}
            {question.required && <span className="text-red-500 ml-1">*</span>}
        </label>
        <div className="flex gap-2">
            <button
                type="button"
                onClick={() => onChange(true)}
                className={clsx(
                    "flex-1 py-1.5 rounded-lg border font-bold text-xs transition-all",
                    value === true
                        ? "border-green-500 bg-green-50 text-green-700"
                        : "border-slate-200 text-slate-500 hover:border-green-300"
                )}
            >
                <div className="flex items-center justify-center gap-1.5">
                    {value === true && <Check size={14} />}
                    Sí
                </div>
            </button>
            <button
                type="button"
                onClick={() => onChange(false)}
                className={clsx(
                    "flex-1 py-1.5 rounded-lg border font-bold text-xs transition-all",
                    value === false
                        ? "border-red-500 bg-red-50 text-red-700"
                        : "border-slate-200 text-slate-500 hover:border-red-300"
                )}
            >
                <div className="flex items-center justify-center gap-1.5">
                    {value === false && <X size={14} />}
                    No
                </div>
            </button>
        </div>
        {question.helpText && (
            <p className="text-[10px] text-slate-400">{question.helpText}</p>
        )}
    </div>
);

// ============================================================================
// Select Input
// ============================================================================
const SelectInput: React.FC<QuestionInputProps & { options: string[] }> = ({ question, value, onChange, options }) => (
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

// ============================================================================
// Multiselect Input
// ============================================================================
const MultiselectInput: React.FC<QuestionInputProps & { options: string[] }> = ({ question, value, onChange, options }) => {
    const selectedValues = (value as string[]) || [];

    return (
        <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-600">
                {question.label}
                {question.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <div className="flex flex-wrap gap-1.5">
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
                                "px-2.5 py-1 rounded-full text-[11px] font-bold transition-all border",
                                isSelected
                                    ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm"
                                    : "border-slate-200 text-slate-400 hover:border-blue-200 hover:text-slate-600"
                            )}
                        >
                            {isSelected && <Check size={10} className="inline mr-1" />}
                            {opt}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

// ============================================================================
// Textarea Input
// ============================================================================
const TextareaInput: React.FC<QuestionInputProps> = ({ question, value, onChange }) => (
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

// ============================================================================
// Time Input
// ============================================================================
const TimeInput: React.FC<QuestionInputProps> = ({ question, value, onChange }) => (
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

// ============================================================================
// Phone Input
// ============================================================================
const PhoneInput: React.FC<QuestionInputProps> = ({ question, value, onChange }) => (
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

// ============================================================================
// Text Input (Default)
// ============================================================================
const TextInput: React.FC<QuestionInputProps> = ({ question, value, onChange }) => (
    <div className="space-y-1.5">
        <label className="block text-xs font-semibold text-slate-600">
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
            <p className="text-[10px] text-slate-400">{question.helpText}</p>
        )}
    </div>
);

// ============================================================================
// Main QuestionInput Component
// ============================================================================
export const QuestionInput: React.FC<QuestionInputProps> = ({ question, value, onChange }) => {
    const options = question.options || [];

    switch (question.type) {
        case 'boolean':
            return <BooleanInput question={question} value={value} onChange={onChange} />;
        case 'select':
            return <SelectInput question={question} value={value} onChange={onChange} options={options} />;
        case 'multiselect':
            return <MultiselectInput question={question} value={value} onChange={onChange} options={options} />;
        case 'textarea':
            return <TextareaInput question={question} value={value} onChange={onChange} />;
        case 'time':
            return <TimeInput question={question} value={value} onChange={onChange} />;
        case 'phone':
            return <PhoneInput question={question} value={value} onChange={onChange} />;
        case 'text':
        default:
            return <TextInput question={question} value={value} onChange={onChange} />;
    }
};

export default QuestionInput;
