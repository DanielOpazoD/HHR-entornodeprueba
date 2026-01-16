import React, { useState, useEffect, useRef } from 'react';
import { searchDiagnoses, TerminologyConcept } from '../../services/terminology/terminologyService';
import { checkAIAvailability } from '../../services/terminology/cie10AISearch';
import { abbreviateDiagnosis } from '../../services/terminology/diagnosisAbbreviations';
import { Search, Loader2, X, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { BaseModal } from './BaseModal';

interface TerminologySuggestorProps {
    value: string;
    onChange: (value: string, concept?: TerminologyConcept) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    iconOffset?: boolean;
    cie10Code?: string; // Current CIE-10 code (shows as badge)
}

export const TerminologySuggestor: React.FC<TerminologySuggestorProps> = ({
    value,
    onChange,
    placeholder,
    className,
    disabled,
    iconOffset = false,
    cie10Code
}) => {
    const [query, setQuery] = useState(value);
    const [suggestions, setSuggestions] = useState<TerminologyConcept[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [aiEnabled, setAiEnabled] = useState<boolean | null>(null); // null = checking
    const containerRef = useRef<HTMLDivElement>(null);

    // Check AI availability when modal opens
    useEffect(() => {
        if (isModalOpen && aiEnabled === null) {
            checkAIAvailability().then(setAiEnabled);
        }
    }, [isModalOpen, aiEnabled]);

    // Update internal state if value changes from outside ONLY when not focused
    // This prevents overwriting user input during typing
    useEffect(() => {
        if (!isFocused) {
            setQuery(value);
        }
    }, [value, isFocused]);

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (query.length >= 2 && isOpen) { // Lower threshold to 2
                setIsLoading(true);
                const results = await searchDiagnoses(query);
                setSuggestions(results);
                setIsLoading(false);
            } else if (query.length < 2) {
                setSuggestions([]);
            }
        }, 300); // Faster debounce (300ms)

        return () => clearTimeout(timer);
    }, [query, isOpen]);

    // Handle click outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (concept: TerminologyConcept) => {
        // Use abbreviated form only (code shown as badge)
        const displayText = abbreviateDiagnosis(concept.display);
        setQuery(displayText);
        onChange(displayText, concept);
        setIsOpen(false);
    };

    return (
        <div ref={containerRef} className="relative w-full">
            <div className="relative group">
                <input
                    type="text"
                    className={clsx(
                        "w-full pl-2",
                        iconOffset ? "pr-14" : "pr-8", // Padding for search button
                        className
                    )}
                    placeholder={placeholder}
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        onChange(e.target.value);
                        setIsOpen(true);
                    }}
                    onFocus={() => {
                        setIsFocused(true);
                        setIsOpen(true);
                    }}
                    onBlur={() => setIsFocused(false)}
                    disabled={disabled}
                />
                <div className={clsx(
                    "absolute top-1/2 -translate-y-1/2 flex items-center gap-1 transition-all duration-300",
                    iconOffset ? "right-9" : "right-1"
                )}>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(true);
                            setIsModalOpen(true);
                        }}
                        className={clsx(
                            "transition-all",
                            cie10Code
                                ? "text-[9px] font-mono text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200"
                                : "p-1 text-slate-400 hover:text-medical-600 hover:bg-slate-100 rounded-md"
                        )}
                        title={cie10Code ? `${cie10Code} - Clic para cambiar` : "Búsqueda CIE-10"}
                        disabled={disabled}
                    >
                        {isLoading ? (
                            <Loader2 size={12} className="animate-spin" />
                        ) : cie10Code ? (
                            cie10Code
                        ) : (
                            <Search size={12} />
                        )}
                    </button>
                </div>
            </div>

            {isOpen && suggestions.length > 0 && (
                <div className="absolute z-50 w-[280px] mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-60 overflow-y-auto overflow-x-hidden animate-scale-in">
                    <div className="p-1">
                        <div className="text-[10px] font-bold text-slate-400 px-2 py-1 uppercase tracking-wider border-b border-slate-50 mb-1 flex justify-between items-center">
                            <span>Diagnósticos CIE-10</span>
                            <button onClick={() => setIsOpen(false)} className="hover:text-red-500"><X size={10} /></button>
                        </div>
                        {suggestions.map((concept) => (
                            <button
                                key={concept.code}
                                onClick={() => handleSelect(concept)}
                                className="w-full text-left px-2 py-1.5 hover:bg-medical-50 rounded transition-colors flex flex-col gap-0.5 group"
                            >
                                <div className="flex items-center justify-between">
                                    <span className="text-[12px] font-medium text-slate-700 leading-tight group-hover:text-medical-700">
                                        {concept.display}
                                    </span>
                                    <span className="text-[10px] bg-medical-100 text-medical-700 px-1.5 py-0.5 rounded font-bold">
                                        {concept.code}
                                    </span>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Advanced Search Modal */}
            <BaseModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Buscar Diagnóstico"
                size="md"
            >
                <div className="space-y-3">
                    {/* AI Status Indicator */}
                    <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Base de datos CIE-10 local</span>
                        {aiEnabled === null ? (
                            <span className="flex items-center gap-1 text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                <Loader2 size={12} className="animate-spin" />
                                Verificando IA...
                            </span>
                        ) : aiEnabled ? (
                            <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                                <Sparkles size={12} />
                                IA Activa
                            </span>
                        ) : (
                            <span className="text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                Solo base local
                            </span>
                        )}
                    </div>

                    <div className="relative">
                        <input
                            autoFocus
                            type="text"
                            className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-medical-500 focus:outline-none text-sm pl-9"
                            placeholder="Buscar diagnóstico..."
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setIsOpen(true);
                            }}
                        />
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        {isLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-medical-500 animate-spin" size={16} />}
                    </div>

                    <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                        {suggestions.length > 0 ? (
                            suggestions.map((concept) => (
                                <button
                                    key={concept.code}
                                    onClick={() => {
                                        handleSelect(concept);
                                        setIsModalOpen(false);
                                    }}
                                    className={clsx(
                                        "w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex justify-between items-center border-b border-slate-100 last:border-b-0",
                                        concept.fromAI && "bg-purple-50/50"
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        {concept.fromAI && <Sparkles size={12} className="text-purple-500" />}
                                        <span className="text-sm text-slate-700">
                                            {concept.display}
                                        </span>
                                    </div>
                                    <span className={clsx(
                                        "text-xs font-mono px-2 py-0.5 rounded",
                                        concept.fromAI ? "text-purple-600 bg-purple-100" : "text-slate-500 bg-slate-100"
                                    )}>
                                        {concept.code}
                                    </span>
                                </button>
                            ))
                        ) : (
                            <div className="p-8 text-center">
                                <Search size={32} className="mx-auto text-slate-300 mb-2" strokeWidth={1} />
                                <p className="text-sm text-slate-400">
                                    {query.length < 2 ? 'Escriba al menos 2 caracteres...' : 'No se encontraron diagnósticos.'}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </BaseModal>
        </div>
    );
};
