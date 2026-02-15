import { describe, expect, it, vi } from 'vitest';
import {
    RESET_DAY_CONFIRM_DIALOG,
    executeResetDayController,
    resolveResetDayPermission
} from '@/features/census/controllers/censusResetDayController';

describe('censusResetDayController', () => {
    it('allows admin users to delete records regardless of date', () => {
        const result = resolveResetDayPermission({
            role: 'admin',
            isToday: false
        });

        expect(result.canDeleteRecord).toBe(true);
        expect(result.denialTitle).toBe('Acceso Denegado');
        expect(result.denialMessage).toBe('');
    });

    it('blocks non-admin users on previous dates with explicit message', () => {
        const result = resolveResetDayPermission({
            role: 'nurse_hospital',
            isToday: false
        });

        expect(result.canDeleteRecord).toBe(false);
        expect(result.denialMessage).toContain('Solo el administrador puede eliminar registros de días anteriores');
    });

    it('blocks users without delete permission on today with permission message', () => {
        const result = resolveResetDayPermission({
            role: 'nurse_hospital',
            isToday: true
        });

        expect(result.canDeleteRecord).toBe(false);
        expect(result.denialMessage).toBe('No tienes permisos para reiniciar este registro.');
    });

    it('exposes a stable confirmation descriptor for reset day action', () => {
        expect(RESET_DAY_CONFIRM_DIALOG).toMatchObject({
            title: '⚠️ Reiniciar registro del día',
            confirmText: 'Sí, reiniciar',
            cancelText: 'Cancelar',
            variant: 'danger'
        });
    });

    it('runtime warns and skips confirm when permission is denied', async () => {
        const warning = vi.fn();
        const confirm = vi.fn();
        const resetDay = vi.fn();
        const permission = resolveResetDayPermission({
            role: 'nurse_hospital',
            isToday: false
        });

        const result = await executeResetDayController(permission, {
            warning,
            confirm,
            resetDay
        });

        expect(result).toEqual({
            ok: true,
            value: { outcome: 'denied' }
        });
        expect(warning).toHaveBeenCalledWith(
            'Acceso Denegado',
            expect.stringContaining('Solo el administrador')
        );
        expect(confirm).not.toHaveBeenCalled();
        expect(resetDay).not.toHaveBeenCalled();
    });

    it('runtime does not reset when user cancels confirmation', async () => {
        const warning = vi.fn();
        const confirm = vi.fn().mockResolvedValue(false);
        const resetDay = vi.fn();
        const permission = resolveResetDayPermission({
            role: 'admin',
            isToday: true
        });

        const result = await executeResetDayController(permission, {
            warning,
            confirm,
            resetDay
        });

        expect(result).toEqual({
            ok: true,
            value: { outcome: 'cancelled' }
        });
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(resetDay).not.toHaveBeenCalled();
        expect(warning).not.toHaveBeenCalled();
    });

    it('runtime resets record when confirmation is accepted', async () => {
        const warning = vi.fn();
        const confirm = vi.fn().mockResolvedValue(true);
        const resetDay = vi.fn();
        const permission = resolveResetDayPermission({
            role: 'admin',
            isToday: true
        });

        const result = await executeResetDayController(permission, {
            warning,
            confirm,
            resetDay
        });

        expect(result).toEqual({
            ok: true,
            value: { outcome: 'reset' }
        });
        expect(confirm).toHaveBeenCalledWith(RESET_DAY_CONFIRM_DIALOG);
        expect(resetDay).toHaveBeenCalledTimes(1);
        expect(warning).not.toHaveBeenCalled();
    });

    it('runtime surfaces explicit error when confirmation flow fails', async () => {
        const permission = resolveResetDayPermission({
            role: 'admin',
            isToday: true
        });

        const result = await executeResetDayController(permission, {
            warning: vi.fn(),
            confirm: vi.fn().mockRejectedValue(new Error('dialog failed')),
            resetDay: vi.fn()
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error.code).toBe('CONFIRMATION_FAILED');
            expect(result.error.message).toContain('No se pudo confirmar');
        }
    });
});
