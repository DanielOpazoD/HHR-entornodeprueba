import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CensusDiagnosisHeaderCell } from '@/features/census/components/CensusDiagnosisHeaderCell';

vi.mock('@/components/ui/ResizableHeader', () => ({
    ResizableHeader: ({ children, className }: { children: ReactNode; className?: string }) => (
        <th className={className}>{children}</th>
    )
}));

describe('CensusDiagnosisHeaderCell', () => {
    it('renders diagnosis label and toggles mode when editable', () => {
        const onToggleDiagnosisMode = vi.fn();

        render(
            <table>
                <thead>
                    <tr>
                        <CensusDiagnosisHeaderCell
                            width={160}
                            isEditMode={false}
                            onResize={vi.fn()}
                            headerClassName="header"
                            readOnly={false}
                            diagnosisMode="free"
                            onToggleDiagnosisMode={onToggleDiagnosisMode}
                        />
                    </tr>
                </thead>
            </table>
        );

        expect(screen.getByText('Diagnóstico')).toBeInTheDocument();
        const toggleButton = screen.getByTitle(/Modo texto libre/);
        fireEvent.click(toggleButton);
        expect(onToggleDiagnosisMode).toHaveBeenCalledTimes(1);
    });

    it('does not render toggle button in read-only mode', () => {
        render(
            <table>
                <thead>
                    <tr>
                        <CensusDiagnosisHeaderCell
                            width={160}
                            isEditMode={false}
                            onResize={vi.fn()}
                            headerClassName="header"
                            readOnly={true}
                            diagnosisMode="cie10"
                            onToggleDiagnosisMode={vi.fn()}
                        />
                    </tr>
                </thead>
            </table>
        );

        expect(screen.queryByTitle(/Modo CIE-10/)).not.toBeInTheDocument();
    });
});
