import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockRole = 'nurse_hospital';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ role: mockRole }),
}));

vi.mock('@/features/prescriptions/services/prescriptionAccessService', () => ({
  setPrescriptionAccessPin: vi.fn(),
}));

vi.mock('@/features/prescriptions/services/prescriptionQrCodeService', () => ({
  buildPrescriptionsUploadUrl: (origin: string) => `${origin}/recetas/upload`,
  renderPrescriptionsUploadQrDataUrl: vi.fn(async () => 'data:image/png;base64,qr'),
}));

vi.mock('@/shared/runtime/browserClipboardRuntime', () => ({
  writeClipboardText: vi.fn(),
}));

import { PrescriptionAdminView } from '@/features/prescriptions/components/PrescriptionAdminView';

describe('PrescriptionAdminView', () => {
  beforeEach(() => {
    mockRole = 'nurse_hospital';
  });

  it('lets hospital nurses access QR configuration without PIN rotation controls', async () => {
    render(<PrescriptionAdminView />);

    expect(screen.getByRole('link', { name: /volver al censo diario/i })).toHaveAttribute(
      'href',
      '/'
    );
    expect(await screen.findByAltText('QR para subir fotos de receta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copiar url/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('PIN de acceso')).not.toBeInTheDocument();
  });

  it('keeps PIN rotation controls available for admins', async () => {
    mockRole = 'admin';
    render(<PrescriptionAdminView />);

    expect(await screen.findByAltText('QR para subir fotos de receta')).toBeInTheDocument();
    expect(screen.getByLabelText('PIN de acceso')).toBeInTheDocument();
  });
});
