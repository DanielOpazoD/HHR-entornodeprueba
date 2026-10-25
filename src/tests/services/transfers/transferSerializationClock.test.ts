import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { transferDocToEntity } from '@/services/transfers/transferSerializationController';

describe('transfer serialization hospital calendar', () => {
  it('reads a legacy request instant on the hospital day and preserves audit instants', () => {
    const instant = Timestamp.fromDate(new Date('2026-10-25T04:30:00.000Z'));
    const transfer = transferDocToEntity(
      { status: 'REQUESTED', requestDate: instant, createdAt: instant, updatedAt: instant },
      'fake-transfer'
    );
    expect(transfer.requestDate).toBe('2026-10-24');
    expect(transfer.createdAt).toBe('2026-10-25T04:30:00.000Z');
    expect(transfer.updatedAt).toBe('2026-10-25T04:30:00.000Z');
  });
});
