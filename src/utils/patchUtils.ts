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
function applySinglePath<T>(obj: T, parts: string[], value: unknown): T {
    if (parts.length === 0) return value as T;

    const [currentPart, ...remainingParts] = parts;

    const currentValue = getChildValue(obj, currentPart);

    let nextValue: unknown;
    if (remainingParts.length === 0) {
        nextValue = value;
    } else {
        const nextPart = remainingParts[0];
        const baseForNext = (currentValue && typeof currentValue === 'object')
            ? currentValue
            : isArrayKey(nextPart)
                ? []
                : {};
        nextValue = applySinglePath(baseForNext, remainingParts, value);
    }

    if (currentValue === nextValue) return obj;

    if (Array.isArray(obj)) {
        const newArr = [...obj] as unknown[];
        newArr[Number(currentPart)] = nextValue;
        return newArr as unknown as T;
    }

    const baseObject = (obj && typeof obj === 'object')
        ? (obj as Record<string, unknown>)
        : {};

    return {
        ...baseObject,
        [currentPart]: nextValue
    } as unknown as T;
}

function getChildValue(source: unknown, key: string): unknown {
    if (!source || typeof source !== 'object') return undefined;

    if (Array.isArray(source)) {
        return source[Number(key)];
    }

    return (source as Record<string, unknown>)[key];
}

function isArrayKey(value: string): boolean {
    return /^\d+$/.test(value);
}
