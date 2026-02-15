import { describe, expect, it, vi } from 'vitest';
import {
    buildPatientNameSelector,
    executeActivateEmptyBedController
} from '@/features/census/controllers/censusEmptyBedActivationController';

describe('censusEmptyBedActivationController', () => {
    it('builds selector with bed id', () => {
        expect(buildPatientNameSelector('R2')).toBe('[data-bed-id="R2"] input[name="patientName"]');
    });

    it('focuses input and clears temporary value when element exists', () => {
        document.body.innerHTML = '<div data-bed-id="R2"><input name="patientName" value="tmp" /></div>';
        const updatePatient = vi.fn();

        const result = executeActivateEmptyBedController({
            bedId: 'R2',
            runtime: {
                updatePatient,
                requestFrame: (callback) => callback(),
                querySelector: (selector) => document.querySelector(selector)
            }
        });

        const input = document.querySelector('[data-bed-id="R2"] input[name="patientName"]') as HTMLInputElement;
        expect(updatePatient).toHaveBeenCalledWith('R2', 'patientName', ' ');
        expect(result).toEqual({
            ok: true,
            value: {
                outcome: 'focused',
                selector: '[data-bed-id="R2"] input[name="patientName"]'
            }
        });
        expect(input.value).toBe('');
    });

    it('returns input_not_found when patient input is missing', () => {
        const result = executeActivateEmptyBedController({
            bedId: 'R9',
            runtime: {
                updatePatient: vi.fn(),
                requestFrame: (callback) => callback(),
                querySelector: () => null
            }
        });

        expect(result).toEqual({
            ok: true,
            value: {
                outcome: 'input_not_found',
                selector: '[data-bed-id="R9"] input[name="patientName"]'
            }
        });
    });

    it('falls back to immediate focus when requestFrame throws', () => {
        document.body.innerHTML = '<div data-bed-id="R4"><input name="patientName" value="tmp" /></div>';

        const result = executeActivateEmptyBedController({
            bedId: 'R4',
            runtime: {
                updatePatient: vi.fn(),
                requestFrame: () => {
                    throw new Error('raf failed');
                },
                querySelector: (selector) => document.querySelector(selector)
            }
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.outcome).toBe('focused');
        }
    });
});
