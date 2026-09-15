// @vitest-environment node
import { describe, expect, it } from 'vitest';

import '../../../extension/health-push-ordering-runtime.js';

type OrderingRuntime = {
  createReceiver: () => { accept: (message: Record<string, unknown>) => boolean };
};

const orderingModule = (
  globalThis as unknown as { HhrHealthPushOrderingRuntime: OrderingRuntime }
).HhrHealthPushOrderingRuntime;

describe('health push ordering runtime (extension)', () => {
  it('acepta secuencias crecientes y rechaza una publicación antigua que llega tarde', () => {
    const ordering = orderingModule.createReceiver();

    expect(ordering.accept({ publicationSequence: 7 })).toBe(true);
    expect(ordering.accept({ publicationSequence: 9 })).toBe(true);
    expect(ordering.accept({ publicationSequence: 8 })).toBe(false);
  });

  it('rechaza duplicados y mensajes sin un orden verificable', () => {
    const ordering = orderingModule.createReceiver();

    expect(ordering.accept({ publicationSequence: 4 })).toBe(true);
    expect(ordering.accept({ publicationSequence: 4 })).toBe(false);
    expect(ordering.accept({})).toBe(false);
    expect(ordering.accept({ publicationSequence: 'invalida' })).toBe(false);
    expect(ordering.accept({ publicationSequence: '5' })).toBe(false);
  });
});
