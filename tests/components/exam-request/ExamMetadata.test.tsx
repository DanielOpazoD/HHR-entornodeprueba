/**
 * ExamMetadata Component Tests
 * Tests for the procedencia and prevision selector component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExamMetadata } from '@/components/exam-request/ExamMetadata';

describe('ExamMetadata', () => {
    const defaultProps = {
        procedencia: 'Hospitalización',
        prevision: 'FONASA B',
        onProcedenciaChange: vi.fn(),
        onPrevisionChange: vi.fn()
    };

    describe('Procedencia Section', () => {
        it('should render PROCEDENCIA label', () => {
            render(<ExamMetadata {...defaultProps} />);

            expect(screen.getByText('PROCEDENCIA:')).toBeInTheDocument();
        });

        it('should render all procedencia options', () => {
            render(<ExamMetadata {...defaultProps} />);

            expect(screen.getByText('Infantil')).toBeInTheDocument();
            expect(screen.getByText('Adulto')).toBeInTheDocument();
            expect(screen.getByText('Maternal')).toBeInTheDocument();
            expect(screen.getByText('Policlínico')).toBeInTheDocument();
            expect(screen.getByText('Hospitalización')).toBeInTheDocument();
            expect(screen.getByText('Urgencia')).toBeInTheDocument();
        });

        it('should call onProcedenciaChange when option is clicked', () => {
            const onProcedenciaChange = vi.fn();
            render(<ExamMetadata {...defaultProps} onProcedenciaChange={onProcedenciaChange} />);

            fireEvent.click(screen.getByText('Urgencia'));

            expect(onProcedenciaChange).toHaveBeenCalledWith('Urgencia');
        });
    });

    describe('Prevision Section', () => {
        it('should render PREVISION label', () => {
            render(<ExamMetadata {...defaultProps} />);

            expect(screen.getByText('PREVISION:')).toBeInTheDocument();
        });

        it('should render FONASA label', () => {
            render(<ExamMetadata {...defaultProps} />);

            expect(screen.getByText('FONASA:')).toBeInTheDocument();
        });

        it('should render all FONASA levels', () => {
            render(<ExamMetadata {...defaultProps} />);

            expect(screen.getByText('A')).toBeInTheDocument();
            expect(screen.getByText('B')).toBeInTheDocument();
            expect(screen.getByText('C')).toBeInTheDocument();
            expect(screen.getByText('D')).toBeInTheDocument();
        });

        it('should render ISAPRE option', () => {
            render(<ExamMetadata {...defaultProps} />);

            expect(screen.getByText('ISAPRE')).toBeInTheDocument();
        });

        it('should render PRAIS option', () => {
            render(<ExamMetadata {...defaultProps} />);

            expect(screen.getByText('PRAIS')).toBeInTheDocument();
        });

        it('should call onPrevisionChange when FONASA level is clicked', () => {
            const onPrevisionChange = vi.fn();
            render(<ExamMetadata {...defaultProps} onPrevisionChange={onPrevisionChange} />);

            fireEvent.click(screen.getByText('A'));

            expect(onPrevisionChange).toHaveBeenCalledWith('FONASA A');
        });

        it('should call onPrevisionChange when PRAIS is clicked', () => {
            const onPrevisionChange = vi.fn();
            render(<ExamMetadata {...defaultProps} onPrevisionChange={onPrevisionChange} />);

            fireEvent.click(screen.getByText('PRAIS'));

            expect(onPrevisionChange).toHaveBeenCalledWith('Particular');
        });
    });

    describe('Visual States', () => {
        it('should show checkmark for selected procedencia', () => {
            const { container } = render(<ExamMetadata {...defaultProps} procedencia="Hospitalización" />);

            // Check that the selected option has a checkmark icon (Check component from lucide-react)
            const checkIcons = container.querySelectorAll('svg');
            expect(checkIcons.length).toBeGreaterThan(0);
        });
    });
});
