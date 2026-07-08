import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/clinical-documents/components/ClinicalDocumentRichTextEditor', () => ({
  ClinicalDocumentRichTextEditor: ({
    sectionId,
    sectionTitle,
    value,
    onChange,
    onActivate,
    disabled,
  }: {
    sectionId: string;
    sectionTitle: string;
    value: string;
    onChange: (next: string) => void;
    onActivate?: (sectionId: string, editor: { focus: () => void; blur: () => void }) => void;
    disabled?: boolean;
  }) => (
    <div data-testid={`editor:${sectionId}`} data-title={sectionTitle}>
      <textarea
        data-testid={`textarea:${sectionId}`}
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
      />
      <button
        type="button"
        data-testid={`activate:${sectionId}`}
        onClick={() => onActivate?.(sectionId, { focus: vi.fn(), blur: vi.fn() })}
      >
        activate
      </button>
    </div>
  ),
}));

import { ClinicalDocumentPlanSection } from '@/features/clinical-documents/components/ClinicalDocumentPlanSection';

const makeProps = (
  overrides: Partial<Record<string, unknown>> = {},
  sectionOverrides: Partial<Record<string, unknown>> = {}
) => {
  const section = {
    id: 'plan',
    title: 'Plan',
    content: '',
    orderIndex: 1,
    type: 'rich',
    isMandatory: false,
    isLocked: false,
    // The default plan layout is 'unified' (single editor); this test file
    // explicitly exercises the structured/split layout, so opt in here.
    layout: 'structured',
    ...sectionOverrides,
  } as unknown as Parameters<typeof ClinicalDocumentPlanSection>[0]['section'];

  return {
    document: { isLocked: false } as unknown as Parameters<
      typeof ClinicalDocumentPlanSection
    >[0]['document'],
    section,
    canEdit: true,
    activePlanSubsectionId: 'analisis' as Parameters<
      typeof ClinicalDocumentPlanSection
    >[0]['activePlanSubsectionId'],
    setActivePlanSubsectionId: vi.fn(),
    onPatchSection: vi.fn(),
    onEditorActivate: vi.fn(),
    onEditorDeactivate: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof ClinicalDocumentPlanSection>[0];
};

describe('ClinicalDocumentPlanSection', () => {
  it('renders multiple subsection editors in the split layout', () => {
    render(<ClinicalDocumentPlanSection {...makeProps()} />);

    const editors = screen.getAllByTestId(/^editor:plan:/);
    expect(editors.length).toBeGreaterThan(1);
  });

  it('forwards changes from a split-layout subsection through onPatchSection', () => {
    const onPatchSection = vi.fn();
    render(<ClinicalDocumentPlanSection {...makeProps({ onPatchSection })} />);

    const firstTextarea = screen.getAllByTestId(/^textarea:plan:/)[0];
    fireEvent.change(firstTextarea, { target: { value: 'updated content' } });

    expect(onPatchSection).toHaveBeenCalledTimes(1);
    expect(onPatchSection.mock.calls[0][0]).toBe('plan');
    expect(typeof onPatchSection.mock.calls[0][1]).toBe('string');
  });

  it('routes activation through setActivePlanSubsectionId and onEditorActivate', () => {
    const setActivePlanSubsectionId = vi.fn();
    const onEditorActivate = vi.fn();
    render(
      <ClinicalDocumentPlanSection
        {...makeProps({ setActivePlanSubsectionId, onEditorActivate })}
      />
    );

    const firstActivate = screen.getAllByTestId(/^activate:plan:/)[0];
    fireEvent.click(firstActivate);

    expect(setActivePlanSubsectionId).toHaveBeenCalledTimes(1);
    expect(onEditorActivate).toHaveBeenCalledTimes(1);
  });

  it('disables editors when canEdit is false or the document is locked', () => {
    const { rerender } = render(<ClinicalDocumentPlanSection {...makeProps({ canEdit: false })} />);
    screen.getAllByTestId(/^textarea:plan:/).forEach(t => expect(t).toBeDisabled());

    rerender(
      <ClinicalDocumentPlanSection
        {...makeProps({ canEdit: true }, {})}
        document={
          { isLocked: true } as unknown as Parameters<
            typeof ClinicalDocumentPlanSection
          >[0]['document']
        }
      />
    );
    screen.getAllByTestId(/^textarea:plan:/).forEach(t => expect(t).toBeDisabled());
  });
});
