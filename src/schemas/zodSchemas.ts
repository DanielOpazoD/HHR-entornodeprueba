/**
 * Zod Schemas for Data Validation - Facade
 *
 * This file re-exports all schemas from domain-specific files
 * for easy consumption throughout the app.
 */

// Re-exports from domain files
export * from './zod/helpers';
export * from './zod/patient';
export * from './zod/movements';
export * from './zod/dailyRecord';
export * from './zod/legacyNormalization';

export * from './zodParseReports';
export * from './zodFallbackBuilders';
export * from './zodSafeParsers';
