import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ClinicalDocumentLockBanner } from '@/features/clinical-documents/components/ClinicalDocumentLockBanner';

describe('ClinicalDocumentLockBanner', () => {
  it('renders nothing when the document is not locked', () => {
    const { container } = render(<ClinicalDocumentLockBanner isLocked={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('explains the episode-close reason and references creating an addenda', () => {
    render(
      <ClinicalDocumentLockBanner
        isLocked
        lockedReason="episode_closed"
        lockedAt="2026-05-04T13:45:00.000Z"
      />
    );

    expect(screen.getByTestId('clinical-document-lock-banner')).toBeInTheDocument();
    expect(screen.getByText(/Documento bloqueado/i)).toBeInTheDocument();
    expect(
      screen.getByText(/quedó bloqueado al cerrarse la hospitalización del paciente/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/crea una addenda en un documento aparte/i)).toBeInTheDocument();
  });

  it('falls back to a generic message when no lock reason is supplied', () => {
    render(<ClinicalDocumentLockBanner isLocked />);
    expect(screen.getByText(/Este documento está bloqueado para edición/i)).toBeInTheDocument();
  });

  it('omits the timestamp suffix when lockedAt is not provided', () => {
    render(<ClinicalDocumentLockBanner isLocked lockedReason="episode_closed" />);
    const message = screen.getByText(
      /quedó bloqueado al cerrarse la hospitalización del paciente/i
    );
    // No "el dd/mm/yyyy hh:mm" suffix
    expect(message.textContent).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('ignores invalid lockedAt strings instead of rendering NaN', () => {
    render(
      <ClinicalDocumentLockBanner isLocked lockedReason="episode_closed" lockedAt="not-a-date" />
    );
    const message = screen.getByText(
      /quedó bloqueado al cerrarse la hospitalización del paciente/i
    );
    expect(message.textContent).not.toMatch(/NaN/);
    expect(message.textContent).not.toMatch(/Invalid/i);
  });
});
