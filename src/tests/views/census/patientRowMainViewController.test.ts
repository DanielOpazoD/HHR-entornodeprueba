import { describe, expect, it } from 'vitest';
import { shouldShowBedTypeToggle } from '@/features/census/controllers/patientRowMainViewController';

describe('patientRowMainViewController', () => {
    it('shows bed type toggle only for editable occupied R beds', () => {
        expect(shouldShowBedTypeToggle({
            bedId: 'R7',
            readOnly: false,
            isEmpty: false
        })).toBe(true);
    });

    it('hides bed type toggle when row is read-only', () => {
        expect(shouldShowBedTypeToggle({
            bedId: 'R7',
            readOnly: true,
            isEmpty: false
        })).toBe(false);
    });

    it('hides bed type toggle when bed is empty or non-regular', () => {
        expect(shouldShowBedTypeToggle({
            bedId: 'R7',
            readOnly: false,
            isEmpty: true
        })).toBe(false);

        expect(shouldShowBedTypeToggle({
            bedId: 'AUX-1',
            readOnly: false,
            isEmpty: false
        })).toBe(false);
    });
});
