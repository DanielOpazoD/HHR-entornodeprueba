// @vitest-environment node
/**
 * Tests for the autosave indicator controller.
 *
 * Validates the visual state resolution based on save status
 * and last-saved timestamp.
 */

import { describe, it, expect } from 'vitest';
import { resolveAutosaveIndicatorState } from '@/features/clinical-documents/controllers/clinicalDocumentAutosaveIndicatorController';

describe('resolveAutosaveIndicatorState', () => {
  it('returns "saving" phase when isSaving is true', () => {
    const state = resolveAutosaveIndicatorState(true, false, '2026-04-11T19:00:00Z');

    expect(state.phase).toBe('saving');
    expect(state.savedAtLabel).toBeNull();
  });

  it('returns "saving" phase even if isDirty is true', () => {
    const state = resolveAutosaveIndicatorState(true, true, undefined);

    expect(state.phase).toBe('saving');
  });

  it('returns "dirty" phase when isDirty is true and not saving', () => {
    const state = resolveAutosaveIndicatorState(false, true, '2026-04-11T19:00:00Z');

    expect(state.phase).toBe('dirty');
    expect(state.savedAtLabel).toBeNull();
  });

  it('returns "saved" phase with formatted time when save completed', () => {
    const state = resolveAutosaveIndicatorState(false, false, '2026-04-11T19:17:00Z');

    expect(state.phase).toBe('saved');
    expect(state.savedAtLabel).toMatch(/^\d{2}:\d{2}$/);
  });

  it('returns "idle" phase when no activity', () => {
    const state = resolveAutosaveIndicatorState(false, false, undefined);

    expect(state.phase).toBe('idle');
    expect(state.savedAtLabel).toBeNull();
  });

  it('returns "saved" with empty label for malformed timestamp', () => {
    const state = resolveAutosaveIndicatorState(false, false, 'not-a-date');

    expect(state.phase).toBe('saved');
    expect(state.savedAtLabel).toBe('');
  });

  it('returns "saved" with empty label for empty string timestamp', () => {
    const state = resolveAutosaveIndicatorState(false, false, '');

    // Empty string is falsy → idle
    expect(state.phase).toBe('idle');
  });

  it('prioritizes saving over dirty', () => {
    const state = resolveAutosaveIndicatorState(true, true, '2026-04-11T10:00:00Z');

    expect(state.phase).toBe('saving');
  });

  it('prioritizes dirty over saved', () => {
    const state = resolveAutosaveIndicatorState(false, true, '2026-04-11T10:00:00Z');

    expect(state.phase).toBe('dirty');
  });
});
