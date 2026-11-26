import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhotoGallery } from '@/features/wound-care/components/PhotoGallery';
import type { WoundCarePhoto, WoundCareAuditActor } from '@/types/domain/woundCare';

type MockPhotoLightboxProps = {
  photos: WoundCarePhoto[];
  currentIndex: number;
  onClose: () => void;
};

type MockPhotoDeleteConfirmProps = {
  onConfirm: () => Promise<{ success: boolean; error?: string }>;
  onCancel: () => void;
};

// Mock the PhotoLightbox — renders via portal which is hard to test
vi.mock('@/features/wound-care/components/PhotoLightbox', () => ({
  PhotoLightbox: ({ photos, currentIndex, onClose }: MockPhotoLightboxProps) => (
    <div data-testid="lightbox">
      <span data-testid="lightbox-index">{currentIndex}</span>
      <span data-testid="lightbox-total">{photos.length}</span>
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

vi.mock('@/features/wound-care/components/PhotoDeleteConfirm', () => ({
  PhotoDeleteConfirm: ({ onConfirm, onCancel }: MockPhotoDeleteConfirmProps) => (
    <div data-testid="delete-confirm">
      <button data-testid="confirm-delete" onClick={onConfirm}>
        confirm
      </button>
      <button onClick={onCancel}>cancel</button>
    </div>
  ),
}));

// ============================================================================
// Helpers
// ============================================================================

const mockActor: WoundCareAuditActor = {
  uid: 'u1',
  email: 'e@e.cl',
  displayName: 'Test',
  role: 'editor',
};

const makePhoto = (id: string, takenAt: string): WoundCarePhoto => ({
  id,
  patientRut: '1-1',
  patientName: 'P',
  episodeKey: 'ep',
  storagePath: 'p',
  thumbnailStoragePath: 't',
  downloadUrl: `https://test/${id}`,
  thumbnailDownloadUrl: `https://test/${id}_thumb`,
  mimeType: 'image/webp',
  originalFileSize: 5000,
  compressedFileSize: 1000,
  width: 800,
  height: 600,
  takenAt,
  uploadedAt: takenAt,
  uploadedBy: mockActor,
  isDeleted: false,
});

// ============================================================================
// Tests
// ============================================================================

describe('PhotoGallery', () => {
  it('renders empty state when no photos', () => {
    render(<PhotoGallery photos={[]} />);
    expect(screen.getByText(/no hay fotografías/i)).toBeInTheDocument();
  });

  it('renders photos grouped by date', () => {
    const photos: WoundCarePhoto[] = [
      makePhoto('p1', '2026-03-10T10:00:00Z'),
      makePhoto('p2', '2026-03-10T14:00:00Z'),
      makePhoto('p3', '2026-03-11T09:00:00Z'),
    ];

    render(<PhotoGallery photos={photos} />);

    // Two date headers should appear (dd/mm/yyyy format from the controller)
    expect(screen.getByText('11/03/2026')).toBeInTheDocument();
    expect(screen.getByText('10/03/2026')).toBeInTheDocument();

    // Session summaries
    expect(screen.getByText('2 fotos')).toBeInTheDocument();
    expect(screen.getByText('1 foto')).toBeInTheDocument();

    // Thumbnails rendered as images
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(3);
  });

  it('opens lightbox when photo thumbnail clicked', () => {
    const photos: WoundCarePhoto[] = [
      makePhoto('p1', '2026-03-10T10:00:00Z'),
      makePhoto('p2', '2026-03-10T14:00:00Z'),
    ];

    render(<PhotoGallery photos={photos} />);

    // No lightbox initially
    expect(screen.queryByTestId('lightbox')).not.toBeInTheDocument();

    // Click first thumbnail
    const images = screen.getAllByRole('img');
    const firstButton = images[0].closest('button')!;
    fireEvent.click(firstButton);

    // Lightbox should now be visible
    expect(screen.getByTestId('lightbox')).toBeInTheDocument();
    expect(screen.getByTestId('lightbox-total')).toHaveTextContent('2');
  });

  it('shows delete button for non-readOnly with onDelete', () => {
    const photos: WoundCarePhoto[] = [makePhoto('p1', '2026-03-10T10:00:00Z')];
    const onDelete = vi.fn().mockResolvedValue({ success: true });

    render(<PhotoGallery photos={photos} readOnly={false} onDelete={onDelete} />);

    // Delete button should exist (title "Eliminar foto")
    const deleteButton = screen.getByTitle('Eliminar foto');
    expect(deleteButton).toBeInTheDocument();
  });

  it('does not show delete button when readOnly', () => {
    const photos: WoundCarePhoto[] = [makePhoto('p1', '2026-03-10T10:00:00Z')];
    const onDelete = vi.fn().mockResolvedValue({ success: true });

    render(<PhotoGallery photos={photos} readOnly={true} onDelete={onDelete} />);

    // Delete button should not be present
    expect(screen.queryByTitle('Eliminar foto')).not.toBeInTheDocument();
  });

  it('opens delete confirmation when delete button clicked', () => {
    const photos: WoundCarePhoto[] = [makePhoto('p1', '2026-03-10T10:00:00Z')];
    const onDelete = vi.fn().mockResolvedValue({ success: true });

    render(<PhotoGallery photos={photos} readOnly={false} onDelete={onDelete} />);

    // No confirmation dialog initially
    expect(screen.queryByTestId('delete-confirm')).not.toBeInTheDocument();

    // Click delete button
    fireEvent.click(screen.getByTitle('Eliminar foto'));

    // Confirmation dialog should appear
    expect(screen.getByTestId('delete-confirm')).toBeInTheDocument();
  });
});
