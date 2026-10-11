import { useState, useEffect, useRef } from 'react';
import {
  searchDiagnoses,
  forceAISearch,
  TerminologyConcept,
} from '@/services/terminology/terminologyService';
import { checkAIAvailability } from '@/services/terminology/cie10AISearch';
import { getCachedAIResults, cacheAIResults } from '@/services/terminology/aiResultsCache';
import { createScopedLogger } from '@/services/utils/loggerScope';

const terminologySuggestorLogger = createScopedLogger('TerminologySuggestor');

export interface UseTerminologySuggestorProps {
  value: string;
  onChange: (value: string, concept?: TerminologyConcept) => void;
  cie10Code?: string;
  freeTextValue?: string;
}

export const useTerminologySuggestor = ({
  value,
  onChange,
  cie10Code,
  freeTextValue,
}: UseTerminologySuggestorProps) => {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<TerminologyConcept[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalJustClosedRef = useRef(false);
  const activeSearchRef = useRef<AbortController | null>(null);

  // Check AI availability when modal opens
  useEffect(() => {
    if (!isModalOpen) return;
    let active = true;
    checkAIAvailability().then(available => {
      if (active) setAiEnabled(available);
    });
    return () => {
      active = false;
    };
  }, [isModalOpen]);

  // Auto-load cached AI results when modal opens
  useEffect(() => {
    if (isModalOpen) {
      const searchTerm = cie10Code || query || freeTextValue;
      if (searchTerm && searchTerm.length >= 2) {
        const cachedResults = getCachedAIResults(searchTerm);
        if (cachedResults && cachedResults.length > 0) {
          const cachedConcepts: TerminologyConcept[] = cachedResults.map(entry => ({
            code: entry.code,
            display: entry.description,
            system: 'http://hl7.org/fhir/sid/icd-10',
            category: (entry.category || '') + ' (IA ⚡)',
            fromAI: true,
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
      onChangeRef.current(val);
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
      onChangeRef.current(val);
    }
  };

  const prevModalOpenRef = useRef(false);

  useEffect(() => {
    if (!isFocused && !isModalOpen && value !== query && value !== lastPushedValueRef.current) {
      setQuery(value);
      lastPushedValueRef.current = value;
      currentQueryRef.current = value;
    }

    if (isModalOpen && !prevModalOpenRef.current) {
      const fillValue = value || query || freeTextValue;
      if (fillValue && fillValue.length >= 2) {
        setQuery(fillValue);
      }
    }

    prevModalOpenRef.current = isModalOpen;
  }, [value, isFocused, isModalOpen, query, freeTextValue]);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    return () => {
      if (onChangeTimerRef.current) {
        clearTimeout(onChangeTimerRef.current);
        if (currentQueryRef.current !== lastPushedValueRef.current) {
          onChangeRef.current(currentQueryRef.current);
        }
      }
    };
  }, []);

  // Debounced search - waits for user to stop typing
  useEffect(() => {
    const controller = new AbortController();
    activeSearchRef.current = controller;
    setIsLoading(false);
    if (query.length < 2) setSuggestions([]);

    const timer = setTimeout(async () => {
      if (controller.signal.aborted) return;
      if (query.length >= 2 && isModalOpen) {
        setIsLoading(true);

        try {
          const results = await searchDiagnoses(query, controller.signal);
          if (!controller.signal.aborted) setSuggestions(results);
        } catch (err: unknown) {
          if (!controller.signal.aborted && err instanceof Error && err.name !== 'AbortError') {
            terminologySuggestorLogger.error(`Search failed for "${query}"`, err);
          }
        } finally {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        }
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
      activeSearchRef.current?.abort();
      activeSearchRef.current = null;
    };
  }, [query, isModalOpen, cie10Code, freeTextValue]);

  const handleSelect = (concept: TerminologyConcept) => {
    if (onChangeTimerRef.current) {
      clearTimeout(onChangeTimerRef.current);
      onChangeTimerRef.current = null;
    }

    const fullText = `${concept.display}${concept.code ? ` [${concept.code}]` : ''}`;
    setQuery(fullText);
    currentQueryRef.current = fullText;
    lastPushedValueRef.current = fullText;

    setSuggestions([]);
    onChangeRef.current(fullText, concept);
    setIsModalOpen(false);
  };

  const handleForceAI = async () => {
    const searchTerm = cie10Code || query || freeTextValue;
    if (!searchTerm || !isModalOpen) return;
    activeSearchRef.current?.abort();
    const controller = new AbortController();
    activeSearchRef.current = controller;
    setIsLoading(true);
    try {
      const results = await forceAISearch(searchTerm, controller.signal);
      if (controller.signal.aborted) return;

      if (query && query.length >= 3 && query !== searchTerm) {
        const aiEntries = results
          .filter(r => r.fromAI)
          .map(r => ({
            code: r.code as string,
            description: r.display,
            category: r.category?.replace(' (IA 🔄)', ''),
          }));

        if (aiEntries.length > 0) {
          cacheAIResults(query, aiEntries);
        }
      }

      setSuggestions(results);
    } catch (err: unknown) {
      if (!controller.signal.aborted && err instanceof Error && err.name !== 'AbortError') {
        terminologySuggestorLogger.error(`Force AI search failed for "${searchTerm}"`, err);
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  };

  return {
    state: {
      query,
      suggestions,
      isLoading,
      isModalOpen,
      isFocused,
      aiEnabled,
    },
    refs: {
      containerRef,
      inputRef,
      modalJustClosedRef,
    },
    actions: {
      setQuery,
      setIsModalOpen,
      setIsFocused,
      handleSelect,
      handleForceAI,
      debouncedOnChange,
      flushChanges,
    },
  };
};
