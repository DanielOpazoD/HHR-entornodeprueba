import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { searchDiagnoses, forceAISearch, TerminologyConcept } from '../../services/terminology/terminologyService';
import { checkAIAvailability } from '../../services/terminology/cie10AISearch';
import { getCachedAIResults, cacheAIResults } from '../../services/terminology/aiResultsCache';
import { Search, Loader2, X, Sparkles, RefreshCw } from 'lucide-react';
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
    freeTextValue?: string; // Original free-text diagnosis to auto-fill search
}

export const TerminologySuggestor: React.FC<TerminologySuggestorProps> = ({
    value,
    onChange,
    placeholder,
    className,
    disabled,
    iconOffset = false,
    cie10Code,
    freeTextValue
}) => {
    const [query, setQuery] = useState(value);
    const [suggestions, setSuggestions] = useState<TerminologyConcept[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [aiEnabled, setAiEnabled] = useState<boolean | null>(null); // null = checking
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 });

    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const searchIdRef = useRef(0); // For identifying the latest search

    // Update position when opening
    useEffect(() => {
        if (isOpen && inputRef.current) {
            const rect = inputRef.current.getBoundingClientRect();
            setDropdownPos({
                top: rect.bottom + window.scrollY,
                left: rect.left + window.scrollX,
                width: Math.max(rect.width, 300)
            });
        }
    }, [isOpen, query]);

    // Check AI availability when modal opens
    useEffect(() => {
        if (isModalOpen && aiEnabled === null) {
            checkAIAvailability().then(setAiEnabled);
        }
    }, [isModalOpen, aiEnabled]);

    // Auto-load cached AI results when modal opens
    useEffect(() => {
        if (isModalOpen) {
            const searchTerm = cie10Code || query || freeTextValue;
            if (searchTerm && searchTerm.length >= 2) {
                // Check for cached AI results
                const cachedResults = getCachedAIResults(searchTerm);
                if (cachedResults && cachedResults.length > 0) {
                    // Convert to TerminologyConcept format
                    const cachedConcepts: TerminologyConcept[] = cachedResults.map(entry => ({
                        code: entry.code,
                        display: entry.description,
                        system: 'http://hl7.org/fhir/sid/icd-10',
                        category: (entry.category || '') + ' (IA ⚡)',
                        fromAI: true
                    }));
                    setSuggestions(cachedConcepts);
                }
            }
        }
    }, [isModalOpen, cie10Code, freeTextValue, query]);

    const onChangeTimerRef = useRef<NodeJS.Timeout | null>(null);
    const lastPushedValueRef = useRef<string>(value);
    const currentQueryRef = useRef<string>(value);

    // Keep currentQueryRef in sync with query state
    useEffect(() => {
        currentQueryRef.current = query;
    }, [query]);

    // Debounced onChange for text updates
    const debouncedOnChange = (val: string) => {
        if (onChangeTimerRef.current) {
            clearTimeout(onChangeTimerRef.current);
        }
        onChangeTimerRef.current = setTimeout(() => {
            lastPushedValueRef.current = val;
            onChange(val);
            onChangeTimerRef.current = null;
        }, 500);
    };

    // Immediate flush for blur and unmount behavior
    const flushChanges = (val: string) => {
        if (onChangeTimerRef.current) {
            clearTimeout(onChangeTimerRef.current);
            onChangeTimerRef.current = null;
        }
        if (val !== lastPushedValueRef.current) {
            lastPushedValueRef.current = val;
            onChange(val);
        }
    };

    // Update internal state if value changes from outside
    useEffect(() => {
        if (!isFocused && value !== query && value !== lastPushedValueRef.current) {
            setQuery(value);
            lastPushedValueRef.current = value;
            currentQueryRef.current = value;
        }
    }, [value, isFocused, query]);

    // Cleanup timers and FLUSH on unmount
    useEffect(() => {
        return () => {
            if (onChangeTimerRef.current) {
                clearTimeout(onChangeTimerRef.current);
                // Flush the latest known query value
                if (currentQueryRef.current !== lastPushedValueRef.current) {
                    onChange(currentQueryRef.current);
                }
            }
        };
    }, [onChange]); // Include onChange as dependency to use the correct handler


    // Debounced search - waits for user to stop typing
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (query.length >= 3 && isOpen) {
                const currentId = ++searchIdRef.current;
                setIsLoading(true);

                try {
                    const results = await searchDiagnoses(query);

                    // Only update if this is still the latest search
                    if (currentId === searchIdRef.current) {
                        setSuggestions(results);
                    }
                } finally {
                    if (currentId === searchIdRef.current) {
                        setIsLoading(false);
                    }
                }
            } else if (query.length < 3) {
                setSuggestions([]);
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [query, isOpen]);


    // Handle click outside to close
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                // Check if click is on the portal dropdown
                const dropdown = document.getElementById('terminology-dropdown');
                if (dropdown && dropdown.contains(event.target as Node)) {
                    return;
                }
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (concept: TerminologyConcept) => {
        // Clear any pending debounced change to avoid overwriting selected concept
        if (onChangeTimerRef.current) {
            clearTimeout(onChangeTimerRef.current);
            onChangeTimerRef.current = null;
        }

        // Use the FULL display text for the pathology field to ensure data integrity
        // as requested by the user ("que el texto quede guardado")
        const fullText = concept.display;
        setQuery(fullText);
        lastPushedValueRef.current = fullText;
        onChange(fullText, concept);
        setIsOpen(false);
    };

    return (
        <div ref={containerRef} className="relative w-full">
            <div className="relative group">
                <input
                    ref={inputRef}
                    type="text"
                    className={clsx(
                        "w-full pl-2",
                        iconOffset ? "pr-14" : "pr-8", // Padding for search button
                        className
                    )}
                    placeholder={placeholder}
                    value={query}
                    onChange={(e) => {
                        const val = e.target.value;
                        setQuery(val);
                        debouncedOnChange(val);
                        setIsOpen(true);
                    }}
                    onFocus={() => {
                        setIsFocused(true);
                        setIsOpen(true);
                    }}
                    onBlur={() => {
                        setIsFocused(false);
                        flushChanges(query);
                    }}
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
                            // Auto-fill query with freeTextValue if current query is empty
                            if (!query && freeTextValue) {
                                setQuery(freeTextValue);
                            }
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

            {isOpen && suggestions.length > 0 && createPortal(
                <div
                    id="terminology-dropdown"
                    className="absolute z-[9999] mt-1 bg-white border border-slate-200 rounded-lg shadow-xl animate-scale-in overflow-y-auto max-h-[250px]"
                    style={{
                        position: 'absolute',
                        top: dropdownPos.top,
                        left: dropdownPos.left,
                        width: dropdownPos.width,
                        pointerEvents: 'auto'
                    }}
                >
                    <div className="p-1">
                        <div className="text-[10px] font-bold text-slate-400 px-2 py-1 uppercase tracking-wider border-b border-slate-50 mb-1 flex justify-between items-center">
                            <span>Diagnósticos CIE-10</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setIsOpen(false);
                                }}
                                className="hover:text-red-500"
                            >
                                <X size={10} />
                            </button>
                        </div>
                        {suggestions.map((concept) => (
                            <button
                                key={concept.code}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelect(concept);
                                }}
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
                </div>,
                document.body
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
                            className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-medical-500 focus:outline-none text-sm pl-9 pr-28"
                            placeholder="Buscar diagnóstico..."
                            value={query}
                            onChange={(e) => {
                                const val = e.target.value;
                                setQuery(val);
                                debouncedOnChange(val);
                                setIsOpen(true);
                            }}
                            onBlur={() => flushChanges(query)}
                        />
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        {isLoading && <Loader2 className="absolute right-12 top-1/2 -translate-y-1/2 text-medical-500 animate-spin" size={16} />}
                        {/* Force AI Search Button */}
                        <button
                            type="button"
                            onClick={async () => {
                                const searchTerm = cie10Code || query || freeTextValue;
                                if (!searchTerm || searchTerm.length < 2) return;

                                const currentId = ++searchIdRef.current;
                                const originalQuery = query;

                                setIsLoading(true);
                                try {
                                    const results = await forceAISearch(searchTerm);

                                    // For persistence: if we searched by code, ALSO cache results for the current text query
                                    // This prevents the debounced search from MISSING if the user stays on the text
                                    if (originalQuery && originalQuery.length >= 3 && originalQuery !== searchTerm) {
                                        // Filter only AI results to cache as AI results
                                        const aiEntries = results
                                            .filter(r => r.fromAI)
                                            .map(r => ({
                                                code: r.code,
                                                description: r.display,
                                                category: r.category?.replace(' (IA 🔄)', '')
                                            }));

                                        if (aiEntries.length > 0) {
                                            cacheAIResults(originalQuery, aiEntries);
                                        }
                                    }

                                    if (currentId === searchIdRef.current) {
                                        setSuggestions(results);
                                    }
                                } finally {
                                    if (currentId === searchIdRef.current) {
                                        setIsLoading(false);
                                    }
                                }
                            }}
                            disabled={isLoading || (!cie10Code && !query && !freeTextValue)}
                            className={clsx(
                                "absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all",
                                isLoading || (!cie10Code && !query && !freeTextValue)
                                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                    : "bg-purple-100 text-purple-700 hover:bg-purple-200"
                            )}
                            title="Forzar nueva búsqueda con IA"
                        >
                            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
                            IA
                        </button>
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
                                    {query.length < 3 ? 'Escriba al menos 3 caracteres...' : 'No se encontraron diagnósticos.'}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </BaseModal>
        </div>
    );
};
