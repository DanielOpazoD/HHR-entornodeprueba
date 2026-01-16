import React, { useState, useEffect, useRef } from 'react';
import { searchDiagnoses, TerminologyConcept } from '../../services/terminology/terminologyService';
import { Search, Loader2, Check, X, ClipboardCheck } from 'lucide-react';
import clsx from 'clsx';
import { BaseModal } from './BaseModal';

interface TerminologySuggestorProps {
    value: string;
    onChange: (value: string, concept?: TerminologyConcept) => void;
    placeholder?: string;
    className?: string;
    disabled?: boolean;
    iconOffset?: boolean; // Prop to move icons left for external icons
}

export const TerminologySuggestor: React.FC<TerminologySuggestorProps> = ({
    value,
    onChange,
    placeholder,
    className,
    disabled,
    iconOffset = false
}) => {
    const [query, setQuery] = useState(value);
    const [suggestions, setSuggestions] = useState<TerminologyConcept[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

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
        setQuery(concept.display);
        onChange(concept.display, concept);
        setIsOpen(false);
    };

    return (
        <div ref={containerRef} className="relative w-full">
            <div className="relative group">
                <input
                    type="text"
                    className={clsx(
                        iconOffset ? "pr-12" : "pr-8", // Padding for search button only
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
                    iconOffset ? "right-8" : "right-1" // Shift left if offset requested
                )}>
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(true);
                            setIsModalOpen(true);
                        }}
                        className="p-1 text-slate-400 hover:text-medical-600 hover:bg-slate-100 rounded-md transition-all"
                        title="Búsqueda avanzada CIE-10"
                        disabled={disabled}
                    >
                        {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
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
                                    className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors flex justify-between items-center border-b border-slate-100 last:border-b-0"
                                >
                                    <span className="text-sm text-slate-700">
                                        {concept.display}
                                    </span>
                                    <span className="text-xs text-slate-500 font-mono bg-slate-100 px-2 py-0.5 rounded">
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
