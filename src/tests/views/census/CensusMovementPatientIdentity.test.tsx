import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CensusMovementPatientIdentity } from '@/features/census/components/CensusMovementPatientIdentity';

describe('CensusMovementPatientIdentity', () => {
  it('keeps the identifier intact with the historical admission date under the patient name', () => {
    render(
      <table>
        <tbody>
          <tr>
            <CensusMovementPatientIdentity
              name="Paciente Ejemplo"
              identifier="A33206667"
              admissionDate="2026-09-20"
            />
          </tr>
        </tbody>
      </table>
    );

    const name = screen.getByText('Paciente Ejemplo');
    const identifier = screen.getByText('A33206667');
    expect(identifier.closest('td')).toBe(name.closest('td'));
    expect(identifier).toHaveClass('whitespace-nowrap');
    expect(screen.getByText('FI: 20-09-2026')).toBeInTheDocument();
  });

  it('does not invent an admission date when the historical snapshot lacks one', () => {
    render(
      <table>
        <tbody>
          <tr>
            <CensusMovementPatientIdentity name="Paciente" identifier="123" />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.queryByText(/FI:/)).not.toBeInTheDocument();
  });
});
