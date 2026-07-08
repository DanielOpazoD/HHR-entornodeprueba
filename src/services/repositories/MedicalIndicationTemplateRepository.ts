import {
  getActiveHospitalId,
  getMedicalIndicationTemplateItemsPath,
} from '@/constants/firestorePaths';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { firestoreDb } from '@/services/storage/firestore';
import type { MedicalIndicationTemplate } from '@/shared/contracts/medicalIndications';

const sortTemplates = (items: MedicalIndicationTemplate[]): MedicalIndicationTemplate[] =>
  [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const MedicalIndicationTemplateRepository = {
  async listActiveByUser(
    userId: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<MedicalIndicationTemplate[]> {
    if (!isFirestoreEnabled() || !userId.trim()) return [];

    const documents = await firestoreDb.getDocs<MedicalIndicationTemplate>(
      getMedicalIndicationTemplateItemsPath(userId, hospitalId),
      { orderBy: [{ field: 'updatedAt', direction: 'desc' }] }
    );

    return sortTemplates(documents.filter(item => item.userId === userId && !item.isArchived));
  },

  async create(
    template: MedicalIndicationTemplate,
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    if (!isFirestoreEnabled()) {
      throw new Error('Firestore no está disponible para guardar indicaciones personales.');
    }

    await firestoreDb.setDoc(
      getMedicalIndicationTemplateItemsPath(template.userId, hospitalId),
      template.id,
      template
    );
  },

  async update(
    templateId: string,
    userId: string,
    patch: { text: string; updatedAt: string },
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    if (!isFirestoreEnabled()) {
      throw new Error('Firestore no está disponible para actualizar indicaciones personales.');
    }

    await firestoreDb.updateDoc(
      getMedicalIndicationTemplateItemsPath(userId, hospitalId),
      templateId,
      {
        text: patch.text,
        updatedAt: patch.updatedAt,
      }
    );
  },

  async archive(
    templateId: string,
    userId: string,
    archivedAt: string,
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    if (!isFirestoreEnabled()) {
      throw new Error('Firestore no está disponible para archivar indicaciones personales.');
    }

    await firestoreDb.updateDoc(
      getMedicalIndicationTemplateItemsPath(userId, hospitalId),
      templateId,
      {
        isArchived: true,
        updatedAt: archivedAt,
      }
    );
  },

  async markUsed(
    templateId: string,
    userId: string,
    lastUsedAt: string,
    useCount: number,
    hospitalId: string = getActiveHospitalId()
  ): Promise<void> {
    if (!isFirestoreEnabled()) return;

    await firestoreDb.updateDoc(
      getMedicalIndicationTemplateItemsPath(userId, hospitalId),
      templateId,
      {
        lastUsedAt,
        useCount,
        updatedAt: lastUsedAt,
      }
    );
  },
};
