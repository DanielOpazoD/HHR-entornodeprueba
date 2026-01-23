import React, { useState, useEffect, useRef } from 'react';
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
    cie10Code?: string; // Current CIE-10 code (shows as badge)
    freeTextValue?: string; // Original free-text diagnosis to auto-fill search
}

export const TerminologySuggestor: React.FC<TerminologySuggestorProps> = ({
    value,
    onChange,
    placeholder,
    className,
    disabled = false,
    cie10Code,
    freeTextValue
}) => {
    const [query, setQuery] = useState(value);
    const [suggestions, setSuggestions] = useState<TerminologyConcept[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const [aiEnabled, setAiEnabled] = useState<boolean | null>(null); // null = checking

    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const modalJustClosedRef = useRef(false);

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
        // Prevent updating query from props while the user is actively searching in the modal or focusing the input
        if (!isFocused && !isModalOpen && value !== query && value !== lastPushedValueRef.current) {
            setQuery(value);
            lastPushedValueRef.current = value;
            currentQueryRef.current = value;
        }
    }, [value, isFocused, isModalOpen, query]);

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
        const controller = new AbortController();

        const timer = setTimeout(async () => {
            // Only search if modal is open and we have minimal query length
            if (query.length >= 2 && isModalOpen) {
                setIsLoading(true);

                try {
                    const results = await searchDiagnoses(query, controller.signal);
                    setSuggestions(results);
                } catch (err: unknown) {
                    if (err instanceof Error && err.name !== 'AbortError') {
                        console.error('Search error:', err);
                    }
                } finally {
                    if (!controller.signal.aborted) {
                        setIsLoading(false);
                    }
                }
            } else if (query.length < 2) {
                setSuggestions([]);
            }
        }, 600);

        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query, isModalOpen]);

    const handleSelect = (concept: TerminologyConcept) => {
        // Clear any pending debounced change to avoid overwriting selected concept
        if (onChangeTimerRef.current) {
            clearTimeout(onChangeTimerRef.current);
            onChangeTimerRef.current = null;
        }

        // Use the FULL display text for the pathology field to ensure data integrity
        // as requested by the user ("que el texto quede guardado")
        const fullText = `${concept.display}${concept.code ? ` [${concept.code}]` : ''}`;
        setQuery(fullText);
        currentQueryRef.current = fullText;
        lastPushedValueRef.current = fullText;

        setSuggestions([]);
        onChange(fullText, concept);
        setIsModalOpen(false);
    };

    return (
        <div ref={containerRef} className="relative w-full">
            <div className="relative group">
                <input
                    ref={inputRef}
                    type="text"
                    className={clsx(
                        "w-full pl-2 cursor-pointer bg-white group-hover:bg-slate-50 transition-all border border-slate-200 rounded px-2 py-1.5 text-sm",
                        "focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500/50 outline-none shadow-sm",
                        className
                    )}
                    placeholder={placeholder || 'Buscar diagnóstico...'}
                    value={query}
                    onClick={() => {
                        if (!modalJustClosedRef.current) setIsModalOpen(true);
                    }}
                    onFocus={() => {
                        if (!modalJustClosedRef.current) setIsModalOpen(true);
                        setIsFocused(true);
                    }}
                    onBlur={() => {
                        setIsFocused(false);
                        flushChanges(query);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsModalOpen(true);
                        }
                    }}
                    disabled={disabled}
                    readOnly // Direct editing is disabled in favor of the specialized modal
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover:text-medical-500 transition-colors">
                    <Search size={14} />
                </div>
            </div>

            {/* Complete Advanced Search Modal */}
            <BaseModal
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    // Prevent immediate re-trigger by focus return
                    modalJustClosedRef.current = true;
                    setTimeout(() => { modalJustClosedRef.current = false; }, 200);
                }}
                title="Selector de Diagnóstico CIE-10"
                icon={<Search className="text-medical-600" size={20} />}
                size="lg" // Larger for a more "complete" feel
            >
                <div className="space-y-4">
                    {/* Status area */}
                    <div className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider">
                        <span className="text-slate-400">Base Local CIE-10</span>
                        {aiEnabled === null ? (
                            <span className="flex items-center gap-1.5 text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                                <Loader2 size={12} className="animate-spin" />
                                Verificando IA...
                            </span>
                        ) : aiEnabled ? (
                            <span className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-100">
                                <Sparkles size={12} />
                                IA Activa
                            </span>
                        ) : (
                            <span className="text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                                Modo Local
                            </span>
                        )}
                    </div>

                    {/* Search Input in Modal */}
                    <div className="relative">
                        <input
                            autoFocus
                            type="text"
                            className="w-full p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-medical-500 focus:outline-none text-sm pl-11 pr-28 shadow-inner bg-slate-50/50"
                            placeholder="Describa el diagnóstico o ingrese código..."
                            value={query}
                            onChange={(e) => {
                                const val = e.target.value;
                                setQuery(val);
                                debouncedOnChange(val);
                            }}
                        />
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        {isLoading && <Loader2 className="absolute right-12 top-1/2 -translate-y-1/2 text-medical-500 animate-spin" size={18} />}

                        {/* Clear Button */}
                        {query && (
                            <button
                                onClick={() => { setQuery(''); debouncedOnChange(''); }}
                                className="absolute right-12 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-200 rounded-full text-slate-400 transition-colors mr-2"
                            >
                                <X size={14} />
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={async () => {
                                const searchTerm = cie10Code || query || freeTextValue;
                                if (!searchTerm) return;
                                const controller = new AbortController();
                                setIsLoading(true);
                                try {
                                    const results = await forceAISearch(searchTerm, controller.signal);

                                    // For persistence: if we searched by code, ALSO cache results for the current text query
                                    if (query && query.length >= 3 && query !== searchTerm) {
                                        const aiEntries = results
                                            .filter(r => r.fromAI)
                                            .map(r => ({
                                                code: r.code,
                                                description: r.display,
                                                category: r.category?.replace(' (IA 🔄)', '')
                                            }));

                                        if (aiEntries.length > 0) {
                                            cacheAIResults(query, aiEntries);
                                        }
                                    }

                                    setSuggestions(results);
                                } catch (err: unknown) {
                                    if (err instanceof Error && err.name !== 'AbortError') {
                                        console.error('Force AI search error:', err);
                                    }
                                } finally {
                                    setIsLoading(false);
                                }
                            }}
                            disabled={isLoading || !query}
                            className={clsx(
                                "absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm",
                                isLoading || !query
                                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                    : "bg-purple-600 text-white hover:bg-purple-700 active:scale-95"
                            )}
                        >
                            <RefreshCw size={12} className={isLoading ? "animate-spin" : ""} />
                            IA
                        </button>
                    </div>

                    {/* Results List */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[400px] overflow-y-auto bg-white shadow-sm">
                        {suggestions.length > 0 ? (
                            <div className="divide-y divide-slate-100">
                                {suggestions.map((concept) => (
                                    <button
                                        key={concept.code}
                                        onClick={() => handleSelect(concept)}
                                        className={clsx(
                                            "w-full text-left px-4 py-3 hover:bg-medical-50/50 transition-colors flex justify-between items-start group",
                                            concept.fromAI && "bg-purple-50/30 hover:bg-purple-50/60"
                                        )}
                                    >
                                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                {concept.fromAI ? (
                                                    <Sparkles size={14} className="text-purple-500 shrink-0" />
                                                ) : (
                                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0 ml-1 mr-1" />
                                                )}
                                                <span className="text-sm font-semibold text-slate-700 leading-tight group-hover:text-medical-700">
                                                    {concept.display}
                                                </span>
                                            </div>
                                            {concept.category && (
                                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider ml-5 truncate">
                                                    {concept.category}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0 ml-4">
                                            <span className={clsx(
                                                "text-xs font-mono px-2 py-0.5 rounded-md font-bold border",
                                                concept.fromAI
                                                    ? "text-purple-700 bg-purple-100 border-purple-200"
                                                    : "text-slate-600 bg-slate-100 border-slate-200"
                                            )}>
                                                {concept.code}
                                            </span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="p-12 text-center">
                                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <Search size={32} className="text-slate-300" strokeWidth={1} />
                                </div>
                                <p className="text-sm text-slate-500 font-medium">
                                    {query.length < 2 ? 'Escriba al menos 2 caracteres...' : 'No se encontraron diagnósticos exactos.'}
                                </p>
                                <p className="text-xs text-slate-400 mt-1">
                                    Pulse el botón <span className="text-purple-600 font-bold">IA</span> para una búsqueda avanzada.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </BaseModal>
        </div>
    );
};
