/**
 * ExamCheckbox Component Tests
 * Tests for the individual exam checkbox component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExamCheckbox } from '@/components/exam-request/ExamCheckbox';

describe('ExamCheckbox', () => {
    const defaultProps = {
        exam: 'HEMOGRAMA',
        categoryTitle: 'HEMATOLOGIA',
        isSelected: false,
        onToggle: vi.fn()
    };

    describe('Rendering', () => {
        it('should render exam name', () => {
            render(<ExamCheckbox {...defaultProps} />);

            expect(screen.getByText('HEMOGRAMA')).toBeInTheDocument();
        });

        it('should not show X mark when not selected', () => {
            render(<ExamCheckbox {...defaultProps} isSelected={false} />);

            expect(screen.queryByText('X')).not.toBeInTheDocument();
        });

        it('should show X mark when selected', () => {
            render(<ExamCheckbox {...defaultProps} isSelected={true} />);

            expect(screen.getByText('X')).toBeInTheDocument();
        });
    });

    describe('Interaction', () => {
        it('should call onToggle with correct examKey when clicked', () => {
            const onToggle = vi.fn();
            render(<ExamCheckbox {...defaultProps} onToggle={onToggle} />);

            fireEvent.click(screen.getByText('HEMOGRAMA'));

            expect(onToggle).toHaveBeenCalledTimes(1);
            expect(onToggle).toHaveBeenCalledWith('HEMATOLOGIA|HEMOGRAMA');
        });

        it('should work with different category and exam combinations', () => {
            const onToggle = vi.fn();
            render(
                <ExamCheckbox
                    exam="GLICEMIA"
                    categoryTitle="BIOQUIMICA"
                    isSelected={false}
                    onToggle={onToggle}
                />
            );

            fireEvent.click(screen.getByText('GLICEMIA'));

            expect(onToggle).toHaveBeenCalledWith('BIOQUIMICA|GLICEMIA');
        });
    });

    describe('Visual States', () => {
        it('should have cursor-pointer class for interactivity', () => {
            const { container } = render(<ExamCheckbox {...defaultProps} />);

            const wrapper = container.firstChild as HTMLElement;
            expect(wrapper.className).toContain('cursor-pointer');
        });

        it('should have hover styles class', () => {
            const { container } = render(<ExamCheckbox {...defaultProps} />);

            const wrapper = container.firstChild as HTMLElement;
            expect(wrapper.className).toContain('hover:bg-slate-50');
        });
    });
});
