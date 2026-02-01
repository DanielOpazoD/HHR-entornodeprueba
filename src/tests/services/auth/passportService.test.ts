import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    isEligibleForPassport,
    generatePassport,
    validatePassport,
    verifyPassportCredentials,
    parsePassportFile,
    storePassportLocally,
    getStoredPassport
} from '@/services/auth/passportService';
import * as idbService from '@/services/storage/indexedDBService';

// Mock IndexedDB
vi.mock('@/services/storage/indexedDBService', () => ({
    getSetting: vi.fn(),
    saveSetting: vi.fn(),
}));

describe('passportService', () => {
    const mockUser = {
        uid: 'user123',
        email: 'admin@hospital.cl',
        displayName: 'Admin User',
        role: 'admin'
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Support TextEncoder/Decoder and base64 in Node
        if (typeof global.TextEncoder === 'undefined') {
            const { TextEncoder, TextDecoder } = require('util');
            global.TextEncoder = TextEncoder;
            global.TextDecoder = TextDecoder;
        }

        // Mock crypto for node
        if (!global.crypto || !global.crypto.subtle) {
            const { webcrypto } = require('node:crypto');
            Object.defineProperty(global, 'crypto', {
                value: webcrypto,
                configurable: true
            });
        }
    });

    describe('isEligibleForPassport', () => {
        it('should return true for admin', () => {
            expect(isEligibleForPassport(mockUser)).toBe(true);
        });

        it('should return true for nurse_hospital', () => {
            expect(isEligibleForPassport({ ...mockUser, role: 'nurse_hospital' })).toBe(true);
        });

        it('should return false for other roles or null', () => {
            expect(isEligibleForPassport({ ...mockUser, role: 'resident' })).toBe(false);
            expect(isEligibleForPassport(null)).toBe(false);
        });
    });

    describe('generate and validate', () => {
        it('should generate a valid passport and validate it', async () => {
            const passport = await generatePassport(mockUser);
            expect(passport).not.toBeNull();
            if (passport) {
                const result = await validatePassport(passport);
                expect(result.valid).toBe(true);
                expect(result.user?.email).toBe(mockUser.email);
            }
        });

        it('should fail validation if signature is invalid', async () => {
            const passport = await generatePassport(mockUser);
            if (passport) {
                passport.signature = 'invalid-sig';
                const result = await validatePassport(passport);
                expect(result.valid).toBe(false);
                expect(result.error).toContain('Firma');
            }
        });

        it('should fail if expired', async () => {
            const passport = await generatePassport(mockUser);
            if (passport) {
                // Use E2E bypass to skip signature check since we are mutating the data
                passport.signature += '-e2e-test';
                passport.expiresAt = '2020-01-01T00:00:00.000Z';
                const result = await validatePassport(passport);
                expect(result.valid).toBe(false);
                expect(result.error).toContain('expirado');
            }
        });
    });

    describe('verifyPassportCredentials', () => {
        it('should fail for old passports without hash', async () => {
            const passport = await generatePassport(mockUser);
            if (passport) {
                const isValid = await verifyPassportCredentials(passport, mockUser.email, 'password');
                expect(isValid).toBe(false);
            }
        });
    });

    describe('File Operations', () => {
        it('should parse a valid .hhr file', async () => {
            const passport = await generatePassport(mockUser);
            if (!passport) throw new Error('Failed to generate passport');
            const jsonContent = JSON.stringify(passport);

            // Match the encoding used in downloadPassport
            const base64Content = btoa(unescape(encodeURIComponent(jsonContent)));

            const fileMock = {
                name: 'test.hhr',
                text: async () => base64Content
            };

            const parsed = await parsePassportFile(fileMock as any);

            expect(parsed).not.toBeNull();
            expect(parsed?.email).toBe(mockUser.email);
        });

        it('should return null for invalid extensions', async () => {
            const file = new File(['test'], 'test.txt');
            const parsed = await parsePassportFile(file);
            expect(parsed).toBeNull();
        });
    });

    describe('Storage', () => {
        it('should store and get passport', async () => {
            const passport = await generatePassport(mockUser);
            if (passport) {
                await storePassportLocally(passport);
                expect(idbService.saveSetting).toHaveBeenCalledWith('hhr_offline_passport', passport);

                vi.mocked(idbService.getSetting).mockResolvedValue(passport);
                const retrieved = await getStoredPassport();
                expect(retrieved).toEqual(passport);
            }
        });
    });
});
