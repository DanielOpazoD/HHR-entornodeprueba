import { describe, expect, it, vi } from 'vitest';

import { buildPatientInputSectionBindings } from '@/features/census/controllers/patientInputSectionBindingsController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('patientInputSectionBindingsController', () => {
  it('builds section bindings with shared state and handlers', () => {
    const data = DataFactory.createMockPatient('R1');
    const handleDebouncedText = vi.fn();
    const onDemo = vi.fn();
    const onChange = {
      text: vi.fn(),
      check: vi.fn(),
      devices: vi.fn(),
      deviceDetails: vi.fn(),
      deviceHistory: vi.fn(),
      toggleDocType: vi.fn(),
      deliveryRoute: vi.fn(),
      multiple: vi.fn(),
    };

    const bindings = buildPatientInputSectionBindings({
      data,
      currentDateString: '2026-02-15',
      isSubRow: false,
      isEmpty: false,
      isLocked: true,
      diagnosisMode: 'free',
      hasRutError: true,
      handleDebouncedText,
      onDemo,
      onChange,
    });

    expect(bindings.identity.shared).toBe(bindings.clinical.shared);
    expect(bindings.identity.shared).toBe(bindings.flow.shared);
    expect(bindings.identity.shared).toBe(bindings.flags.shared);
    expect(bindings.identity.hasRutError).toBe(true);
    expect(bindings.clinical.diagnosisMode).toBe('free');
    expect(bindings.flow.onChange).toBe(onChange);
    expect(bindings.flags.onChange).toBe(onChange);
    expect(bindings.clinical.onChange).toBe(onChange);
    expect(bindings.identity.onDemo).toBe(onDemo);
    expect(bindings.identity.handleDebouncedText).toBe(handleDebouncedText);
    expect(bindings.flow.handleDebouncedText).toBe(handleDebouncedText);
    expect(bindings.identity.shared).toMatchObject({
      data,
      currentDateString: '2026-02-15',
      isSubRow: false,
      isEmpty: false,
      isLocked: true,
    });
    expect(Object.keys(bindings).sort()).toEqual(['clinical', 'flags', 'flow', 'identity']);
  });
});
