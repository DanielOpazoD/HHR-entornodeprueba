/**
 * ExamFormHeader Component Tests
 * Tests for the institutional header component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExamFormHeader } from '@/components/exam-request/ExamFormHeader';

describe('ExamFormHeader', () => {
    describe('Institutional Branding', () => {
        it('should render Hospital Hanga Roa name', () => {
            render(<ExamFormHeader />);

            expect(screen.getByText('Hospital Hanga Roa')).toBeInTheDocument();
        });

        it('should render Unidad de Laboratorio subtitle', () => {
            render(<ExamFormHeader />);

            expect(screen.getByText('Unidad de Laboratorio')).toBeInTheDocument();
        });

        it('should render form title', () => {
            render(<ExamFormHeader />);

            expect(screen.getByText('Solicitud de Exámenes de Laboratorio Policlínico')).toBeInTheDocument();
        });

        it('should render Red Salud Oriente', () => {
            render(<ExamFormHeader />);

            expect(screen.getByText('Red Salud Oriente')).toBeInTheDocument();
        });
    });

    describe('Logo Images', () => {
        it('should render HHR logo', () => {
            render(<ExamFormHeader />);

            const hhrLogo = screen.getByAltText('Logo HHR');
            expect(hhrLogo).toBeInTheDocument();
            expect(hhrLogo).toHaveAttribute('src', '/images/logos/logo_HHR.png');
        });

        it('should render SSMO logo', () => {
            render(<ExamFormHeader />);

            const ssmoLogo = screen.getByAltText('Logo SSMO');
            expect(ssmoLogo).toBeInTheDocument();
            expect(ssmoLogo).toHaveAttribute('src', '/images/logos/logo_SSMO.jpg');
        });
    });

    describe('Layout', () => {
        it('should have flex layout', () => {
            const { container } = render(<ExamFormHeader />);

            const header = container.firstChild as HTMLElement;
            expect(header.className).toContain('flex');
            expect(header.className).toContain('justify-between');
        });

        it('should have bottom border', () => {
            const { container } = render(<ExamFormHeader />);

            const header = container.firstChild as HTMLElement;
            expect(header.className).toContain('border-b-2');
        });
    });
});
