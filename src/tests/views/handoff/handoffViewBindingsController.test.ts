import { describe, expect, it, vi } from 'vitest';
import { buildHandoffClinicalEventActions } from '@/features/handoff/controllers/handoffViewBindingsController';

describe('handoffViewBindingsController', () => {
  it('gates clinical event actions through edit capability', () => {
    const editable = buildHandoffClinicalEventActions({
      canEditClinicalEvents: true,
      onAdd: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });
    const readOnly = buildHandoffClinicalEventActions({
      canEditClinicalEvents: false,
      onAdd: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    });

    expect(editable.onAdd).toBeTypeOf('function');
    expect(editable.onUpdate).toBeTypeOf('function');
    expect(editable.onDelete).toBeTypeOf('function');
    expect(readOnly.onAdd).toBeUndefined();
    expect(readOnly.onUpdate).toBeUndefined();
    expect(readOnly.onDelete).toBeUndefined();
  });
});
