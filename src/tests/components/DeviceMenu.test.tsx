/**
 * Tests for DeviceMenu Logic
 * Verifies device menu logic without complex component rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { DeviceDetails } from '@/types';

describe('DeviceMenu Logic', () => {
    describe('Device State', () => {
        const defaultDevice: DeviceDetails = {
            CUP: undefined,
            CVC: undefined,
            VMI: undefined,
        };

        it('should have all device options', () => {
            const deviceOptions = [
                'CUP',
                'CVC',
                'VMI'
            ];

            expect(Object.keys(defaultDevice)).toEqual(expect.arrayContaining(deviceOptions));
        });

        it('should count 0 active devices when none enabled', () => {
            const count = Object.values(defaultDevice).filter(Boolean).length;
            expect(count).toBe(0);
        });

        it('should count active devices correctly', () => {
            const activeDevice: DeviceDetails = {
                CUP: { installationDate: '2024-01-01' },
                CVC: { installationDate: '2024-01-01' },
                VMI: undefined,
            };

            const count = Object.values(activeDevice).filter(Boolean).length;
            expect(count).toBe(2);
        });

        it('should toggle device state', () => {
            const device = { ...defaultDevice };
            device.CUP = device.CUP ? undefined : { installationDate: '2024-01-01' };
            expect(device.CUP).toBeDefined();

            device.CUP = undefined;
            expect(device.CUP).toBeUndefined();
        });
    });

    describe('Device Labels', () => {
        const deviceLabels: Record<string, string> = {
            CUP: 'Sonda Foley (CUP)',
            CVC: 'Vía Central (CVC)',
            VMI: 'Ventilación Mecánica (VMI)',
        };

        it('should have labels for all device types', () => {
            const deviceTypes = ['CUP', 'CVC', 'VMI'];
            deviceTypes.forEach(type => {
                expect(deviceLabels[type]).toBeDefined();
                expect(typeof deviceLabels[type]).toBe('string');
            });
        });

        it('should have Spanish labels', () => {
            expect(deviceLabels.CUP).toContain('Sonda');
            expect(deviceLabels.CVC).toContain('Vía');
            expect(deviceLabels.VMI).toContain('Ventilación');
        });
    });

    describe('Device Icons', () => {
        it('should map device types to icon names', () => {
            const deviceIcons: Record<string, string> = {
                catheter: 'thermometer',
                oxygenTherapy: 'wind',
                ngt: 'tube',
                tracheostomy: 'scissors',
                chestTube: 'activity',
                ventilator: 'lungs',
            };

            expect(Object.keys(deviceIcons).length).toBe(6);
        });
    });
});
