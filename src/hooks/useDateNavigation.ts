import React, { useState, useMemo } from 'react';

/**
 * Return type for useDateNavigation hook.
 * Provides date selection state and derived values for navigation.
 */
export interface UseDateNavigationReturn {
    /** Currently selected year (e.g., 2024) */
    selectedYear: number;
    /** Set the selected year */
    setSelectedYear: React.Dispatch<React.SetStateAction<number>>;
    /** Currently selected month (0-11, where 0 = January) */
    selectedMonth: number;
    /** Set the selected month */
    setSelectedMonth: React.Dispatch<React.SetStateAction<number>>;
    /** Currently selected day of month (1-31) */
    selectedDay: number;
    /** Set the selected day */
    setSelectedDay: React.Dispatch<React.SetStateAction<number>>;
    /** Number of days in the currently selected month */
    daysInMonth: number;
    /** Formatted date string in YYYY-MM-DD format */
    currentDateString: string;
    /** Navigate days forward or backward, handling month/year transitions */
    navigateDays: (delta: number) => void;
}

/**
 * useDateNavigation Hook
 * 
 * Manages the date selection state for navigating between daily records.
 * Provides year, month, and day state with setters, plus derived values
 * like days in month and formatted date string.
 * 
 * Initializes to the current date on mount.
 * 
 * @returns Date selection state and setters
 * 
 * @example
 * ```tsx
 * const {
 *     selectedYear, setSelectedYear,
 *     selectedMonth, setSelectedMonth,
 *     selectedDay, setSelectedDay,
 *     currentDateString
 * } = useDateNavigation();
 * 
 * // currentDateString = "2024-12-27"
 * ```
 */
export const useDateNavigation = (): UseDateNavigationReturn => {
    // 0. Resolve initial date from URL or System
    const [initialDate] = useState<Date>(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const dateParam = params.get('date');
            if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
                const [y, m, d] = dateParam.split('-').map(Number);
                const dObj = new Date(y, m - 1, d);
                if (!isNaN(dObj.getTime())) return dObj;
            }
        }
        return new Date();
    });

    // Date Selection State
    const [selectedYear, setSelectedYear] = useState<number>(initialDate.getFullYear());
    const [selectedMonth, setSelectedMonth] = useState<number>(initialDate.getMonth()); // 0-11
    const [selectedDay, setSelectedDay] = useState<number>(initialDate.getDate());

    // Calculate days in selected month
    const daysInMonth = useMemo(() => {
        return new Date(selectedYear, selectedMonth + 1, 0).getDate();
    }, [selectedYear, selectedMonth]);

    // Format current date as YYYY-MM-DD
    const currentDateString = useMemo(() => {
        const y = selectedYear;
        const m = String(selectedMonth + 1).padStart(2, '0');
        const d = String(selectedDay).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }, [selectedYear, selectedMonth, selectedDay]);

    // Navigate days forward or backward, handling month/year transitions
    const navigateDays = React.useCallback((delta: number) => {
        const nextDate = new Date(selectedYear, selectedMonth, selectedDay + delta);
        setSelectedYear(nextDate.getFullYear());
        setSelectedMonth(nextDate.getMonth());
        setSelectedDay(nextDate.getDate());
    }, [selectedYear, selectedMonth, selectedDay]);

    return {
        selectedYear,
        setSelectedYear,
        selectedMonth,
        setSelectedMonth,
        selectedDay,
        setSelectedDay,
        daysInMonth,
        currentDateString,
        navigateDays
    };
};
