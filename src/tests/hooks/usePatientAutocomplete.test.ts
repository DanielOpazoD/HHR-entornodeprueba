import { renderHook, waitFor, act } from '@testing-library/react';
import { usePatientAutocomplete } from '@/hooks/usePatientAutocomplete';
import { PatientMasterRepository } from '@/services/repositories/PatientMasterRepository';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MasterPatient } from '@/types';

// Mock Repository
vi.mock('@/services/repositories/PatientMasterRepository', () => ({
    PatientMasterRepository: {
        getPatientByRut: vi.fn(),
    },
}));

describe('usePatientAutocomplete', () => {
    const mockRut = '11.111.111-1';
    const mockPatient: MasterPatient = {
        rut: '11.111.111-1',
        fullName: 'Test Patient',
        birthDate: '1990-01-01',
        gender: 'Masculino',
        forecast: 'Fonasa',
        createdAt: 12345,
        updatedAt: 12345
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should initialize with default state', () => {
        const { result } = renderHook(() => usePatientAutocomplete(''));
        expect(result.current.suggestion).toBeNull();
        expect(result.current.isLoading).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('should not search for invalid RUT', async () => {
        const { result } = renderHook(() => usePatientAutocomplete('invalid-rut'));

        // Wait a bit more than debounce
        await act(async () => {
            await new Promise(r => setTimeout(r, 600));
        });

        expect(PatientMasterRepository.getPatientByRut).not.toHaveBeenCalled();
        expect(result.current.suggestion).toBeNull();
    });

    it('should search for valid RUT after debounce', async () => {
        vi.mocked(PatientMasterRepository.getPatientByRut).mockResolvedValue(mockPatient);

        const { result } = renderHook(() => usePatientAutocomplete(mockRut));

        // initially false
        expect(result.current.isLoading).toBe(false);

        // Wait for results with a generous timeout
        await waitFor(() => {
            expect(result.current.suggestion).toEqual(mockPatient);
        }, { timeout: 2000 });

        expect(PatientMasterRepository.getPatientByRut).toHaveBeenCalledWith(mockRut);
        expect(result.current.isLoading).toBe(false);
    });

    it('should handle errors gracefully', async () => {
        const error = new Error('Network error');
        vi.mocked(PatientMasterRepository.getPatientByRut).mockRejectedValue(error);

        const { result } = renderHook(() => usePatientAutocomplete(mockRut));

        await waitFor(() => {
            expect(result.current.error).toEqual(error);
        }, { timeout: 2000 });

        expect(result.current.isLoading).toBe(false);
        expect(result.current.suggestion).toBeNull();
    });

    it('should clear suggestion when requested', async () => {
        vi.mocked(PatientMasterRepository.getPatientByRut).mockResolvedValue(mockPatient);
        const { result } = renderHook(() => usePatientAutocomplete(mockRut));

        await waitFor(() => expect(result.current.suggestion).toEqual(mockPatient), { timeout: 2000 });

        act(() => {
            result.current.clearSuggestion();
        });
        await waitFor(() => expect(result.current.suggestion).toBeNull());
    });
});
