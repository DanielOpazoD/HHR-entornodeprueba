import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  CRITICAL_MEDICATIONS,
  presentationFor,
} from '@/features/clinical-library/domain/criticalMedications';
import { CriticalMedicationsTool } from '@/features/clinical-library/components/tools/CriticalMedicationsTool';

const printMock = vi.hoisted(() =>
  vi.fn((_document: { title: string; body: string; styles: string }) => 'printed' as const)
);
vi.mock('@/features/clinical-library/services/printHtmlDocument', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/features/clinical-library/services/printHtmlDocument')
  >()),
  printHtmlDocument: printMock,
}));

describe('CriticalMedicationsTool', () => {
  it('defaults to the 5 mL ampoules, filters by name and prints the chosen variant', () => {
    render(<CriticalMedicationsTool onBack={vi.fn()} onClose={vi.fn()} patients={[]} />);
    expect(screen.getByRole('button', { name: 'Ampolla 5 mL' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByTestId('critical-medication-dopamina')).toHaveTextContent('250 mg/5 mL');
    expect(screen.getByTestId('critical-medication-noradrenalina')).toHaveTextContent('32 mcg/mL');

    fireEvent.click(screen.getByRole('button', { name: 'Ampolla 10 mL' }));
    expect(screen.getByTestId('critical-medication-dopamina')).toHaveTextContent('250 mg/10 mL');

    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'bicar' } });
    expect(screen.getAllByTestId(/critical-medication-/)).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Buscar'), { target: { value: 'zzz' } });
    expect(screen.getByText('Sin resultados para «zzz»')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('critical-medications-print'));
    const document = printMock.mock.calls[0][0];
    expect(document.body).toContain('ampolla de 10 mL');
  });
  it('preserves complete doses and preparation order for both ampoule variants', () => {
    render(<CriticalMedicationsTool onBack={vi.fn()} onClose={vi.fn()} patients={[]} />);
    for (const variant of ['amp5', 'amp10'] as const) {
      fireEvent.click(
        screen.getByRole('button', { name: variant === 'amp5' ? 'Ampolla 5 mL' : 'Ampolla 10 mL' })
      );
      expect(screen.getAllByTestId(/^critical-medication-/).map(row => row.dataset.testid)).toEqual(
        CRITICAL_MEDICATIONS.map(medication => `critical-medication-${medication.id}`)
      );
      for (const medication of CRITICAL_MEDICATIONS) {
        const row = screen.getByTestId(`critical-medication-${medication.id}`);
        expect(row).toHaveTextContent(medication.dose);
        const presentation = presentationFor(medication, variant);
        expect(row).toHaveTextContent(presentation.text);
        expect([...row.querySelectorAll('li')].map(item => item.textContent)).toEqual(
          presentation.preparations.map(
            item =>
              `${item.label ? `${item.label}: ` : ''}${item.text}${item.concentration ? ` = ${item.concentration}` : ''}`
          )
        );
      }
    }
  });
});
