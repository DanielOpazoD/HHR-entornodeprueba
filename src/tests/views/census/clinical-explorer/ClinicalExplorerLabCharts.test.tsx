import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClinicalExplorerLabCharts } from '@/features/census/components/clinical-explorer/ClinicalExplorerLabCharts';
import type { LabVariable } from '@/features/census/components/clinical-explorer/clinicalExplorerLabModel';

const variable: LabVariable = {
  id: 'hemoglobin',
  name: 'Hemoglobina',
  analysis: 'Hemoglobina',
  unit: 'g/dL',
  points: [
    { columnKey: 'first', dayIso: '2016-01-01', time: '09:00', value: 10, display: '10' },
    { columnKey: 'last', dayIso: '2026-01-01', time: '09:00', value: 12, display: '12' },
  ],
};
const props = {
  variables: [variable],
  startIso: '2016-01-01',
  endIso: '2026-01-01',
  admissionIso: '2016-01-01',
  selectedDay: null,
  onSelectDay: vi.fn(),
  expanded: true,
};

describe('ClinicalExplorerLabCharts', () => {
  it('keeps a decade-long axis readable while retaining every result and the census endpoint', () => {
    const html = renderToStaticMarkup(<ClinicalExplorerLabCharts {...props} />);
    const container = document.createElement('div');
    container.innerHTML = html;
    const labels = container.querySelectorAll('svg[aria-hidden="true"] text');
    expect(labels.length).toBeLessThanOrEqual(10);
    expect(labels[labels.length - 1]).toHaveTextContent('01-01-2026 censo');
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(2);
  });

  it.each([
    ['2026-01-01', '2026-01-01', 1],
    ['2026-01-01', '2026-01-07', 7],
  ] as const)('retains useful daily labels for %s to %s', (startIso, endIso, count) => {
    const container = document.createElement('div');
    container.innerHTML = renderToStaticMarkup(
      <ClinicalExplorerLabCharts {...props} startIso={startIso} endIso={endIso} />
    );
    const labels = container.querySelectorAll('svg[aria-hidden="true"] text');
    expect(labels).toHaveLength(count);
    expect(labels[labels.length - 1]).toHaveTextContent('censo');
  });

  it('keeps every clinical point selectable by pointer and keyboard', () => {
    const onSelectDay = vi.fn();
    render(<ClinicalExplorerLabCharts {...props} onSelectDay={onSelectDay} />);
    fireEvent.click(screen.getByRole('button', { name: /Hemoglobina 10 g\/dL el 01-01-2016/ }));
    expect(onSelectDay).toHaveBeenLastCalledWith('2016-01-01');
    fireEvent.keyDown(screen.getByRole('button', { name: /Hemoglobina 12 g\/dL el 01-01-2026/ }), {
      key: 'Enter',
    });
    expect(onSelectDay).toHaveBeenLastCalledWith('2026-01-01');
  });
});
