import { describe, expect, it } from 'vitest';
import {
    buildDeliveryRoutePatch,
    resolveNextDocumentType
} from '@/features/census/controllers/patientRowInputController';

describe('patientRowInputController', () => {
    it('toggles RUT to Pasaporte and Pasaporte to RUT', () => {
        expect(resolveNextDocumentType('RUT')).toBe('Pasaporte');
        expect(resolveNextDocumentType('Pasaporte')).toBe('RUT');
    });

    it('defaults undefined document type to Pasaporte', () => {
        expect(resolveNextDocumentType(undefined)).toBe('Pasaporte');
    });

    it('builds deterministic delivery route patch', () => {
        expect(buildDeliveryRoutePatch('Vaginal', '2026-02-13')).toEqual({
            deliveryRoute: 'Vaginal',
            deliveryDate: '2026-02-13'
        });
        expect(buildDeliveryRoutePatch(undefined, undefined)).toEqual({
            deliveryRoute: undefined,
            deliveryDate: undefined
        });
    });
});
