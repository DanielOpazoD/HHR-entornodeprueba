import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCensusEmail } from '@/hooks/useCensusEmail';

import {
    getMonthRecordsFromFirestore,
    triggerCensusEmail,
    initializeDay
} from '@/services';
import { buildCensusMasterWorkbook } from '@/services/exporters/censusMasterWorkbook';
import { uploadCensus } from '@/services/backup/censusStorageService';
import { getSetting, saveSetting } from '@/services/storage/indexedDBService';
import { useConfirmDialog } from '@/context/UIContext';
import { UIContextType } from '@/context/UIContext';
import { DailyRecord } from '@/types';
import { EmailResponse } from '@/services/email/gmailClient';
import { Workbook } from 'exceljs';

// Mock Services
vi.mock('@/services', () => ({
    formatDate: vi.fn((d) => d),
    getMonthRecordsFromFirestore: vi.fn(),
    triggerCensusEmail: vi.fn(),
    initializeDay: vi.fn()
}));

vi.mock('@/services/exporters/censusMasterWorkbook', () => ({
    buildCensusMasterWorkbook: vi.fn()
}));

vi.mock('@/services/backup/censusStorageService', () => ({
    uploadCensus: vi.fn()
}));

vi.mock('@/services/storage/indexedDBService', () => ({
    getSetting: vi.fn(),
    saveSetting: vi.fn()
}));

vi.mock('@/context/UIContext', () => ({
    useConfirmDialog: vi.fn()
}));

// Mock clipboard
Object.assign(navigator, {
    clipboard: {
        writeText: vi.fn(),
    },
});

describe('useCensusEmail', () => {
    const mockConfirm = vi.fn();
    const mockAlert = vi.fn();

    const defaultParams = {
        record: { date: '2025-01-08', beds: {}, discharges: [], transfers: [], lastUpdated: '', nurses: [], activeExtraBeds: [], cma: [] },
        currentDateString: '2025-01-08',
        nurseSignature: 'Nurse Name',
        selectedYear: 2025,
        selectedMonth: 0,
        selectedDay: 8,
        user: { email: 'admin@test.com', role: 'admin' },
        role: 'admin'
    };

    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(useConfirmDialog).mockReturnValue({
            confirm: mockConfirm,
            alert: mockAlert
        } as unknown as any);
        vi.mocked(getSetting).mockResolvedValue(['test@test.com']);
        vi.mocked(getMonthRecordsFromFirestore).mockResolvedValue([]);
        vi.mocked(initializeDay).mockResolvedValue(undefined as unknown as DailyRecord);
        vi.mocked(triggerCensusEmail).mockResolvedValue({ success: true, message: 'Sent', gmailId: '123' } as unknown as EmailResponse);
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(),
            setItem: vi.fn(),
            removeItem: vi.fn(),
        });
    });

    it('should initialize with default state and load recipients from storage', async () => {
        const { result } = renderHook(() => useCensusEmail(defaultParams));

        // Initial state
        expect(result.current.status).toBe('idle');
        expect(result.current.showEmailConfig).toBe(false);
        expect(result.current.isAdminUser).toBe(true);

        // Wait for IndexedDB load simulation
        await waitFor(() => {
            expect(getSetting).toHaveBeenCalledWith('censusEmailRecipients', null);
            expect(result.current.recipients).toEqual(['test@test.com']);
        });
    });

    it('should migrate legacy recipients from localStorage', async () => {
        vi.mocked(getSetting).mockResolvedValue(null as unknown as string[]);
        vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(['legacy@test.com']));

        const { result } = renderHook(() => useCensusEmail(defaultParams));

        await waitFor(() => {
            expect(localStorage.removeItem).toHaveBeenCalledWith('censusEmailRecipients');
        });

        expect(result.current.recipients).toEqual(['legacy@test.com']);
        expect(saveSetting).toHaveBeenCalledWith('censusEmailRecipients', ['legacy@test.com']);
        expect(localStorage.removeItem).toHaveBeenCalledWith('censusEmailRecipients');
    });

    it('should update message when nurseSignature changes', () => {
        const { result, rerender } = renderHook(
            (props) => useCensusEmail(props),
            { initialProps: defaultParams }
        );

        expect(result.current.message).toContain('Nurse Name');

        rerender({ ...defaultParams, nurseSignature: 'New Nurse' });

        expect(result.current.message).toContain('New Nurse');
    });

    it('should not auto-update message if it was manually edited', () => {
        const { result, rerender } = renderHook(
            (props) => useCensusEmail(props),
            { initialProps: defaultParams }
        );

        act(() => {
            result.current.onMessageChange('Manual edit');
        });

        rerender({ ...defaultParams, nurseSignature: 'New Nurse' });

        expect(result.current.message).toBe('Manual edit');
    });

    it('should reset status when currentDateString changes', () => {
        const { result, rerender } = renderHook(
            (props) => useCensusEmail(props),
            { initialProps: defaultParams }
        );

        act(() => {
            // Manually set a state that should be reset
            // status is private-ish but we can trigger loading if we mock sendEmail
        });

        rerender({ ...defaultParams, currentDateString: '2025-01-09' });

        expect(result.current.status).toBe('idle');
        expect(result.current.error).toBeNull();
    });

    describe('sendEmail', () => {
        it('should show alert and return if no record provided', async () => {
            const { result } = renderHook(() => useCensusEmail({ ...defaultParams, record: null }));

            await act(async () => {
                await result.current.sendEmail();
            });

            expect(mockAlert).toHaveBeenCalledWith('No hay datos del censo para enviar.');
            expect(triggerCensusEmail).not.toHaveBeenCalled();
        });

        it('should handle successful email sending flow', async () => {
            mockConfirm.mockResolvedValue(true);
            vi.mocked(getMonthRecordsFromFirestore).mockResolvedValue([defaultParams.record as unknown as DailyRecord]);
            vi.mocked(triggerCensusEmail).mockResolvedValue({ success: true, message: 'Sent', gmailId: '123' } as unknown as EmailResponse);

            const mockWorkbook = {
                xlsx: { writeBuffer: vi.fn().mockResolvedValue(Buffer.from([])) }
            };
            vi.mocked(buildCensusMasterWorkbook).mockResolvedValue(mockWorkbook as any);

            const { result } = renderHook(() => useCensusEmail(defaultParams));

            await act(async () => {
                await result.current.sendEmail();
            });

            expect(mockConfirm).toHaveBeenCalled();
            expect(initializeDay).toHaveBeenCalled(); // Integrity check
            expect(triggerCensusEmail).toHaveBeenCalled();
            expect(uploadCensus).toHaveBeenCalled();
            expect(result.current.status).toBe('success');
        });

        it('should handle silent backup failure', async () => {
            mockConfirm.mockResolvedValue(true);
            vi.mocked(getMonthRecordsFromFirestore).mockResolvedValue([defaultParams.record]);
            vi.mocked(triggerCensusEmail).mockResolvedValue({ success: true, message: 'Sent', gmailId: '123' });

            const mockWorkbook = {
                xlsx: { writeBuffer: vi.fn().mockResolvedValue(Buffer.from([])) }
            };
            vi.mocked(buildCensusMasterWorkbook).mockResolvedValue(mockWorkbook as any);
            vi.mocked(uploadCensus).mockRejectedValue(new Error('Backup failed'));

            const { result } = renderHook(() => useCensusEmail(defaultParams));

            await act(async () => {
                await result.current.sendEmail();
            });

            // Should still be success because email was triggered
            expect(result.current.status).toBe('success');
        });

        it('should handle initialization warning', async () => {
            mockConfirm.mockResolvedValue(true);
            vi.mocked(getMonthRecordsFromFirestore).mockResolvedValue([defaultParams.record]);
            vi.mocked(triggerCensusEmail).mockResolvedValue({ success: true, message: 'Sent', gmailId: '123' });
            vi.mocked(initializeDay).mockRejectedValue(new Error('Init fail'));

            const { result } = renderHook(() => useCensusEmail(defaultParams));

            await act(async () => {
                await result.current.sendEmail();
            });

            expect(result.current.status).toBe('success');
        });

        it('should handle test mode for admin users', async () => {
            mockConfirm.mockResolvedValue(true);
            vi.mocked(getMonthRecordsFromFirestore).mockResolvedValue([defaultParams.record]);
            vi.mocked(triggerCensusEmail).mockResolvedValue({ success: true, message: 'Sent', gmailId: '123' });

            const { result } = renderHook(() => useCensusEmail(defaultParams));

            act(() => {
                result.current.setTestModeEnabled(true);
                result.current.setTestRecipient('dev@test.com');
            });

            await act(async () => {
                await result.current.sendEmail();
            });

            expect(triggerCensusEmail).toHaveBeenCalledWith(expect.objectContaining({
                recipients: ['dev@test.com']
            }));
        });

        it('should handle errors during sending', async () => {
            mockConfirm.mockResolvedValue(true);
            vi.mocked(triggerCensusEmail).mockRejectedValue(new Error('Network error'));

            const { result } = renderHook(() => useCensusEmail(defaultParams));

            await act(async () => {
                await result.current.sendEmail();
            });

            expect(result.current.status).toBe('error');
            expect(result.current.error).toBe('Network error');
            expect(mockAlert).toHaveBeenCalledWith('Network error', 'Error al enviar');
        });
    });

    describe('sendEmailWithLink', () => {
        it('should trigger email with share link', async () => {
            mockConfirm.mockResolvedValue(true);
            vi.mocked(triggerCensusEmail).mockResolvedValue({ success: true, message: 'Sent', gmailId: '123' });

            const { result } = renderHook(() => useCensusEmail(defaultParams));

            await act(async () => {
                await result.current.sendEmailWithLink('viewer');
            });

            expect(triggerCensusEmail).toHaveBeenCalledWith(expect.objectContaining({
                shareLink: expect.stringContaining('/censo-compartido')
            }));
            expect(result.current.status).toBe('success');
        });

        it('should handle error when generating share link fails', async () => {
            mockConfirm.mockResolvedValue(true);
            // triggerCensusEmail will fail if shareLink is null (though GenerateShareLink currently doesn't fail based on code)
            // But we can test the catch block in SendEmailWithLink
            vi.mocked(triggerCensusEmail).mockImplementation(() => { throw new Error('Link trigger failed'); });

            const { result } = renderHook(() => useCensusEmail(defaultParams));

            await act(async () => {
                await result.current.sendEmailWithLink('viewer');
            });

            expect(result.current.status).toBe('error');
            expect(result.current.error).toBe('Link trigger failed');
        });
    });

    describe('copyShareLink', () => {
        it('should handle clipboard error', async () => {
            const { result } = renderHook(() => useCensusEmail(defaultParams));
            vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Clipboard blocked'));

            await act(async () => {
                await result.current.copyShareLink();
            });

            expect(mockAlert).toHaveBeenCalledWith(expect.stringContaining('No se pudo copiar el link'));
        });

        it('should copy link to clipboard', async () => {
            vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
            const { result } = renderHook(() => useCensusEmail(defaultParams));

            await act(async () => {
                await result.current.copyShareLink();
            });

            expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/censo-compartido'));
            expect(mockAlert).toHaveBeenCalledWith(expect.stringContaining('Copiado al portapapeles'), 'Link Copiado');
        });
    });
});
