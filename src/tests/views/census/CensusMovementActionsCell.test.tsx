import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';

describe('CensusMovementActionsCell', () => {
    it('renders movement actions and calls handlers by title', () => {
        const onUndo = vi.fn();
        const onEdit = vi.fn();
        const onDelete = vi.fn();

        render(
            <table>
                <tbody>
                    <tr>
                        <CensusMovementActionsCell
                            actions={[
                                { kind: 'undo', title: 'Deshacer (Restaurar a Cama)', className: 'undo', onClick: onUndo },
                                { kind: 'edit', title: 'Editar', className: 'edit', onClick: onEdit },
                                { kind: 'delete', title: 'Eliminar Registro', className: 'delete', onClick: onDelete }
                            ]}
                        />
                    </tr>
                </tbody>
            </table>
        );

        fireEvent.click(screen.getByTitle('Deshacer (Restaurar a Cama)'));
        fireEvent.click(screen.getByTitle('Editar'));
        fireEvent.click(screen.getByTitle('Eliminar Registro'));

        expect(onUndo).toHaveBeenCalledTimes(1);
        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
    });
});
