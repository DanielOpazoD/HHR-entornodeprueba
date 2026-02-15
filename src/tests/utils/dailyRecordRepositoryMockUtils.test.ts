import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types';
import { DataFactory } from '@/tests/factories/DataFactory';
import { wireStatefulDailyRecordRepoMock } from '@/tests/utils/dailyRecordRepositoryMockUtils';

describe('dailyRecordRepositoryMockUtils', () => {
    it('wires getForDate and save with stateful behavior', async () => {
        let currentRecord: DailyRecord | null = DataFactory.createMockDailyRecord('2025-01-01');
        const repo = {
            getForDate: vi.fn(),
            save: vi.fn(),
            updatePartial: vi.fn(),
            syncWithFirestore: vi.fn(),
        };

        wireStatefulDailyRecordRepoMock(repo, {
            getCurrentRecord: () => currentRecord,
            setCurrentRecord: (record) => {
                currentRecord = record;
            },
        });

        const initial = await repo.getForDate('2025-01-01');
        expect(initial?.date).toBe('2025-01-01');

        const nextRecord = DataFactory.createMockDailyRecord('2025-01-02');
        await repo.save(nextRecord);
        expect(currentRecord?.date).toBe('2025-01-02');
    });

    it('applies partial updates using dot-notation patches', async () => {
        let currentRecord: DailyRecord | null = DataFactory.createMockDailyRecord('2025-01-03', {
            beds: {
                R1: DataFactory.createMockPatient('R1', { patientName: 'Antes' }),
            },
        });
        const repo = {
            getForDate: vi.fn(),
            save: vi.fn(),
            updatePartial: vi.fn(),
            syncWithFirestore: vi.fn(),
        };

        wireStatefulDailyRecordRepoMock(repo, {
            getCurrentRecord: () => currentRecord,
            setCurrentRecord: (record) => {
                currentRecord = record;
            },
        });

        await repo.updatePartial('2025-01-03', { 'beds.R1.patientName': 'Despues' });
        expect(currentRecord?.beds.R1.patientName).toBe('Despues');
    });
});
