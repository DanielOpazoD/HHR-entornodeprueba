// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildDeliveryRoutePatch,
  resolveNextDocumentType,
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
    expect(buildDeliveryRoutePatch('Vaginal', '2026-02-13', undefined)).toEqual({
      deliveryRoute: 'Vaginal',
      deliveryDate: '2026-02-13',
      deliveryCesareanLabor: undefined,
    });
    expect(buildDeliveryRoutePatch('Cesárea', '2026-02-13', 'Con TdP')).toEqual({
      deliveryRoute: 'Cesárea',
      deliveryDate: '2026-02-13',
      deliveryCesareanLabor: 'Con TdP',
    });
    expect(buildDeliveryRoutePatch(undefined, undefined, undefined)).toEqual({
      deliveryRoute: undefined,
      deliveryDate: undefined,
      deliveryCesareanLabor: undefined,
    });
  });
});
