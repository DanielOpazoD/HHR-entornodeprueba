import {
    doc,
    getDoc,
    setDoc,
    onSnapshot
} from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { PrintTemplateConfig } from '@/types/printTemplates';
import {
    COLLECTIONS,
    HOSPITAL_COLLECTIONS,
    getActiveHospitalId
} from '@/constants/firestorePaths';

const getTemplateRef = (templateId: string) => doc(
    db,
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.PRINT_TEMPLATES,
    templateId
);

export const PrintTemplateRepository = {
    /**
     * Get a template configuration by ID
     */
    async getTemplate(templateId: string): Promise<PrintTemplateConfig | null> {
        try {
            const docRef = getTemplateRef(templateId);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                return docSnap.data() as PrintTemplateConfig;
            }
            return null;
        } catch (error) {
            console.error(`Error fetching template ${templateId}:`, error);
            return null;
        }
    },

    /**
     * Save/Update a template configuration
     */
    async saveTemplate(config: PrintTemplateConfig): Promise<void> {
        try {
            const docRef = getTemplateRef(config.id);
            await setDoc(docRef, {
                ...config,
                lastUpdated: new Date().toISOString()
            });
        } catch (error) {
            console.error(`Error saving template ${config.id}:`, error);
            throw error;
        }
    },

    /**
     * Subscribe to real-time updates for a template
     */
    subscribe(templateId: string, callback: (config: PrintTemplateConfig | null) => void): () => void {
        const docRef = getTemplateRef(templateId);

        return onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                callback(docSnap.data() as PrintTemplateConfig);
            } else {
                callback(null);
            }
        }, (error) => {
            console.error(`Error subscribing to template ${templateId}:`, error);
            callback(null);
        });
    }
};
