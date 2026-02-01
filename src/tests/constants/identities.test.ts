import { describe, it, expect } from 'vitest';
import {
    INSTITUTIONAL_ACCOUNTS,
    ADMIN_EMAILS,
    isInstitutionalAccount,
    isAdministratorEmail
} from '@/constants/identities';

describe('identities', () => {
    describe('Constants', () => {
        it('should export INSTITUTIONAL_ACCOUNTS', () => {
            expect(INSTITUTIONAL_ACCOUNTS).toBeDefined();
            expect(INSTITUTIONAL_ACCOUNTS.NURSING).toContain('@hospitalhangaroa.cl');
        });

        it('should export ADMIN_EMAILS array', () => {
            expect(ADMIN_EMAILS).toBeDefined();
            expect(ADMIN_EMAILS.length).toBeGreaterThan(0);
        });
    });

    describe('isInstitutionalAccount', () => {
        it('should return true for nursing account', () => {
            expect(isInstitutionalAccount('hospitalizados@hospitalhangaroa.cl')).toBe(true);
        });

        it('should return true for alt nursing account', () => {
            expect(isInstitutionalAccount('enfermeria.hospitalizados@hospitalhangaroa.cl')).toBe(true);
        });

        it('should be case insensitive', () => {
            expect(isInstitutionalAccount('HOSPITALIZADOS@hospitalhangaroa.CL')).toBe(true);
        });

        it('should handle whitespace', () => {
            expect(isInstitutionalAccount('  hospitalizados@hospitalhangaroa.cl  ')).toBe(true);
        });

        it('should return false for null', () => {
            expect(isInstitutionalAccount(null)).toBe(false);
        });

        it('should return false for undefined', () => {
            expect(isInstitutionalAccount(undefined)).toBe(false);
        });

        it('should return false for non-institutional email', () => {
            expect(isInstitutionalAccount('random@gmail.com')).toBe(false);
        });

        it('should return false for empty string', () => {
            expect(isInstitutionalAccount('')).toBe(false);
        });
    });

    describe('isAdministratorEmail', () => {
        it('should return true for admin emails', () => {
            expect(isAdministratorEmail('daniel.opazo@hospitalhangaroa.cl')).toBe(true);
            expect(isAdministratorEmail('d.opazo.damiani@gmail.com')).toBe(true);
        });

        it('should be case insensitive', () => {
            expect(isAdministratorEmail('DANIEL.OPAZO@HOSPITALHANGAROA.CL')).toBe(true);
        });

        it('should handle whitespace', () => {
            expect(isAdministratorEmail('  daniel.opazo@hospitalhangaroa.cl  ')).toBe(true);
        });

        it('should return false for null', () => {
            expect(isAdministratorEmail(null)).toBe(false);
        });

        it('should return false for undefined', () => {
            expect(isAdministratorEmail(undefined)).toBe(false);
        });

        it('should return false for non-admin email', () => {
            expect(isAdministratorEmail('random@example.com')).toBe(false);
        });
    });
});
