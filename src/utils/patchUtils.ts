/**
 * Patch Utilities
 * Utilities for applying partial updates with structural sharing.
 */

import { DailyRecordPatch } from '@/types';

/**
 * Applies dot-notation updates to an object using structural sharing.
 * This ensures that unchanged branches of the object tree keep their references,
 * allowing React.memo to prevent unnecessary re-renders.
 * 
 * @param obj - The base object to patch
 * @param patches - A flat object where keys are dot-paths and values are the new data
 * @returns A new object with the patches applied, sharing unchanged parts with the original
 */
export const applyPatches = <T extends object>(obj: T, patches: DailyRecordPatch): T => {
    if (!obj) return obj;

    let result = { ...obj };

    Object.entries(patches).forEach(([path, value]) => {
        result = applySinglePath(result, path.split('.'), value);
    });

    return result;
};

/**
 * Recursively applies a path of keys to an object, cloning only the path.
 */
function applySinglePath(obj: any, parts: string[], value: any): any {
    if (parts.length === 0) return value;

    const [currentPart, ...remainingParts] = parts;

    // Handle array or object
    const currentValue = (obj && typeof obj === 'object') ? obj[currentPart] : undefined;

    // Create new level
    let nextValue;
    if (remainingParts.length === 0) {
        nextValue = value;
    } else {
        // If it's a nested update, we need to clone the current level
        nextValue = applySinglePath(currentValue || {}, remainingParts, value);
    }

    // Optimization: If the value is already the same reference, return original obj
    if (currentValue === nextValue) return obj;

    // Return new object with cloned path
    if (Array.isArray(obj)) {
        const newArr = [...obj];
        newArr[Number(currentPart)] = nextValue;
        return newArr;
    } else {
        return {
            ...obj,
            [currentPart]: nextValue
        };
    }
}
