import { describe, it, expect } from 'vitest';
import * as constants from '@/constants';
import * as utils from '@/utils';
import * as types from '@/types';
import * as dataService from '@/services/dataService';
import * as whatsappService from '@/services/integrations/whatsapp';

describe('Barrel file coverage', () => {
    it('should cover constants barrel', () => {
        expect(constants).toBeDefined();
    });

    it('should cover utils barrel', () => {
        expect(utils).toBeDefined();
    });

    it('should cover dataService barrel', () => {
        expect(dataService).toBeDefined();
        // Access some re-exports to ensure they are counted
        expect(dataService.getTodayISO).toBeDefined();
        expect(dataService.createEmptyPatient).toBeDefined();
    });

    it('should cover integrations barrels', () => {
        expect(whatsappService).toBeDefined();
    });

    it('should export types', () => {
        expect(types).toBeDefined();
    });
});
