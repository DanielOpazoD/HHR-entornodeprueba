import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { webcrypto } from 'node:crypto';
import {
    isEligibleForPassport,
    generatePassport,
    validatePassport,
    verifyPassportCredentials,
    parsePassportFile,
    storePassportLocally,
    getStoredPassport,
    OfflinePassport
} from '@/services/auth/passportService';
import { AuthUser, UserRole } from '@/types';
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
        role: 'admin' as const
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Support TextEncoder/Decoder and base64 in Node
        if (typeof global.TextEncoder === 'undefined') {
            global.TextEncoder = NodeTextEncoder as unknown as typeof global.TextEncoder;
            global.TextDecoder = NodeTextDecoder as unknown as typeof global.TextDecoder;
        }

        // Mock crypto for node
        if (!global.crypto || !global.crypto.subtle) {
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
            expect(isEligibleForPassport({ ...mockUser, role: 'resident' as UserRole })).toBe(false);
            expect(isEligibleForPassport(null)).toBe(false);
        });

        it('should handle case insensitive roles', () => {
            expect(isEligibleForPassport({ ...mockUser, role: 'ADMIN' as UserRole })).toBe(true);
            expect(isEligibleForPassport({ ...mockUser, role: 'Nurse_Hospital' as UserRole })).toBe(true);
        });

        it('should return false for user without role property', () => {
            const userWithoutRole = { uid: '1', email: 'test@test.com', displayName: 'Test' };
            expect(isEligibleForPassport(userWithoutRole)).toBe(false);
        });

        it('should return false for viewer and editor roles', () => {
            expect(isEligibleForPassport({ ...mockUser, role: 'viewer' as UserRole })).toBe(false);
            expect(isEligibleForPassport({ ...mockUser, role: 'editor' as UserRole })).toBe(false);
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

        it('should fail validation for passport with empty email', async () => {
            const passport = await generatePassport(mockUser);
            if (passport) {
                passport.email = '';
                passport.signature += '-e2e-test';
                const result = await validatePassport(passport);
                expect(result.valid).toBe(false);
                expect(result.error).toContain('incompleto');
            }
        });

        it('should fail validation for passport with empty role', async () => {
            const passport = await generatePassport(mockUser as AuthUser);
            if (passport) {
                passport.role = '' as UserRole;
                passport.signature += '-e2e-test';
                const result = await validatePassport(passport);
                expect(result.valid).toBe(false);
            }
        });

        it('should fail validation for passport with invalid expiresAt date', async () => {
            const issuedAt = new Date();
            const passport: OfflinePassport = {
                email: mockUser.email || '',
                role: mockUser.role as UserRole,
                displayName: mockUser.displayName || mockUser.email || 'Usuario',
                issuedAt: issuedAt.toISOString(),
                expiresAt: 'not-a-date', // This is the invalid date for the test
                signature: 'mock-sig-e2e-test'
            };
            const result = await validatePassport(passport);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('expiración');
        });

        it('should return null when non-admin tries to generate passport', async () => {
            const nonAdminUser = { ...mockUser, role: 'nurse_hospital' as UserRole };
            const passport = await generatePassport({ ...nonAdminUser, uid: 'nurse123' } as AuthUser);
            expect(passport).toBeNull();
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

        it('should fail when email does not match', async () => {
            const passport = await generatePassport(mockUser);
            if (passport) {
                passport.hash = 'somehash';
                passport.salt = 'somesalt';
                const isValid = await verifyPassportCredentials(passport, 'different@email.com', 'password');
                expect(isValid).toBe(false);
            }
        });

        it('should fail when passport has hash but no salt', async () => {
            const passport = await generatePassport(mockUser);
            if (passport) {
                passport.hash = 'somehash';
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
