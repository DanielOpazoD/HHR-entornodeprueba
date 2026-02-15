import { describe, expect, it } from 'vitest';
import { fail, failWithCode, ok } from '@/features/census/controllers/controllerResult';

describe('controllerResult helpers', () => {
    it('builds success results with ok()', () => {
        const result = ok({ kind: 'demo', value: 1 });

        expect(result).toEqual({
            ok: true,
            value: { kind: 'demo', value: 1 }
        });
    });

    it('builds typed failures with failWithCode()', () => {
        const result = failWithCode('DEMO_ERROR', 'Mensaje');

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'DEMO_ERROR',
                message: 'Mensaje'
            }
        });
    });

    it('keeps extra error metadata with fail()', () => {
        const result = fail({
            code: 'WITH_META',
            message: 'Con metadata',
            title: 'Error'
        });

        expect(result).toEqual({
            ok: false,
            error: {
                code: 'WITH_META',
                message: 'Con metadata',
                title: 'Error'
            }
        });
    });
});
