import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClinicalDocumentRecord,
  ClinicalDocumentSection,
} from '@/domain/clinical-documents/entities';
import {
  buildClinicalDocumentIntegrityHash,
  buildClinicalDocumentRenderedText,
} from '@/domain/clinical-documents/rendering';
import { resolveClinicalDocumentPlanSectionLayout } from '@/features/clinical-documents/controllers/clinicalDocumentPlanSectionController';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { buildDoc } from './clinicalDocumentRepositoryFixture';

const storedDocuments = vi.hoisted(() => new Map<string, unknown>());

vi.mock('@/services/storage/firestore', () => ({
  firestoreDb: {
    setDoc: vi.fn(async (collectionPath: string, id: string, record: unknown) => {
      storedDocuments.set(`${collectionPath}/${id}`, structuredClone(record));
    }),
    getDoc: vi.fn(async (collectionPath: string, id: string) => {
      const record = storedDocuments.get(`${collectionPath}/${id}`);
      return record ? structuredClone(record) : null;
    }),
  },
}));

import { firestoreDb } from '@/services/storage/firestore';
import { ClinicalDocumentRepository } from '@/services/repositories/ClinicalDocumentRepository';

const collectionPath = 'hospitals/hhr/clinicalDocuments';
const structuredContent =
  '<div><strong>Indicaciones generales</strong></div><p>Reposo relativo sintético.</p>';

const buildDocument = (section: ClinicalDocumentSection): ClinicalDocumentRecord => ({
  ...buildDoc('layout-roundtrip', 'synthetic-episode__2026-03-05', '2026-03-05T10:00:00.000Z'),
  patientFields: [
    { id: 'nombre', label: 'Nombre', value: 'Paciente sintético', type: 'text', readonly: true },
  ],
  sections: [
    {
      id: 'antecedentes',
      title: 'Antecedentes',
      content: '<p>Antecedente sintético.</p>',
      order: 0,
      required: true,
      visible: true,
    },
    {
      id: 'historia-evolucion',
      title: 'Historia y evolución clínica',
      content: '<p>Evolución sintética.</p>',
      order: 1,
      required: true,
      visible: true,
    },
    {
      id: 'examenes-complementarios',
      title: 'Exámenes complementarios',
      content: '',
      order: 2,
      required: false,
      visible: false,
    },
    {
      id: 'diagnosticos',
      title: 'Diagnósticos de egreso',
      content: '<p>Diagnóstico sintético.</p>',
      order: 3,
      required: false,
      visible: true,
    },
    section,
  ],
  annexContent: '<p>Anexo sintético conservado.</p>',
  currentVersion: 2,
  versionHistory: [
    {
      version: 1,
      savedAt: '2026-03-05T09:00:00.000Z',
      savedBy: {
        uid: 'synthetic-user',
        email: 'synthetic@example.invalid',
        displayName: 'Profesional sintético',
        role: 'doctor_urgency',
      },
      reason: 'manual',
      changedSectionIds: ['plan'],
      sectionSnapshots: [
        {
          sectionId: 'plan',
          title: 'Plan previo',
          content: '<p>Plan sintético previo.</p>',
          order: 4,
        },
      ],
    },
  ],
});

const buildPlanSection = (content: string): ClinicalDocumentSection => ({
  id: 'plan',
  title: 'Plan terapéutico',
  content,
  kind: 'standard',
  updateDate: '2026-03-05',
  updateTime: '10:00',
  order: 4,
  required: true,
  visible: true,
});

describe('ClinicalDocumentRepository section layout persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedDocuments.clear();
    setFirestoreEnabled(true);
  });

  it.each<{
    layout: NonNullable<ClinicalDocumentSection['layout']>;
    content: string;
    description: string;
  }>([
    { layout: 'structured', content: '', description: 'an empty plan' },
    { layout: 'structured', content: '<p>Plan sintético libre.</p>', description: 'plain content' },
    { layout: 'unified', content: '', description: 'an empty plan' },
    { layout: 'unified', content: structuredContent, description: 'legacy subsection headings' },
  ])(
    'preserves explicit $layout layout with $description through save and read',
    async ({ layout, content }) => {
      const section = { ...buildPlanSection(content), layout };
      const document = buildDocument(section);

      const saved = await ClinicalDocumentRepository.saveDraft(document, 'hhr');
      const persisted = storedDocuments.get(`${collectionPath}/${document.id}`);
      const reloaded = await ClinicalDocumentRepository.get(document.id, 'hhr');

      expect(firestoreDb.setDoc).toHaveBeenCalledWith(collectionPath, document.id, saved, {
        merge: true,
      });
      expect(firestoreDb.getDoc).toHaveBeenCalledWith(collectionPath, document.id);
      expect(persisted).toEqual(saved);
      expect(saved.sections).toEqual(document.sections);
      expect(reloaded).toEqual(saved);
      expect(reloaded).toMatchObject({
        ...document,
        renderedText: buildClinicalDocumentRenderedText(document),
        integrityHash: buildClinicalDocumentIntegrityHash(document),
      });
      expect(saved.renderedText).not.toBe(document.renderedText);
      expect(saved.integrityHash).not.toBe(document.integrityHash);
      const reloadedPlan = reloaded?.sections.find(candidate => candidate.id === 'plan');
      expect(reloadedPlan).toBeDefined();
      if (!reloadedPlan) throw new Error('Expected the persisted plan section');
      expect(resolveClinicalDocumentPlanSectionLayout(reloadedPlan)).toBe(layout);
    }
  );

  it.each<{
    content: string;
    expectedLayout: NonNullable<ClinicalDocumentSection['layout']>;
    description: string;
  }>([
    { content: '', expectedLayout: 'unified', description: 'an empty plan' },
    {
      content: structuredContent,
      expectedLayout: 'structured',
      description: 'subsection headings',
    },
  ])(
    'keeps legacy sections without a layout compatible with $description',
    async ({ content, expectedLayout }) => {
      const section = buildPlanSection(content);
      const document = buildDocument(section);

      const saved = await ClinicalDocumentRepository.saveDraft(document, 'hhr');
      const reloaded = await ClinicalDocumentRepository.get(document.id, 'hhr');

      expect(storedDocuments.get(`${collectionPath}/${document.id}`)).toEqual(saved);
      expect(saved.sections).toEqual(document.sections);
      expect(saved.sections.find(candidate => candidate.id === 'plan')).not.toHaveProperty(
        'layout'
      );
      expect(reloaded).toEqual(saved);
      const reloadedPlan = reloaded?.sections.find(candidate => candidate.id === 'plan');
      expect(reloadedPlan).toBeDefined();
      if (!reloadedPlan) throw new Error('Expected the persisted plan section');
      expect(reloadedPlan).not.toHaveProperty('layout');
      expect(resolveClinicalDocumentPlanSectionLayout(reloadedPlan)).toBe(expectedLayout);
      expect(reloaded).toMatchObject({
        ...document,
        renderedText: buildClinicalDocumentRenderedText(document),
        integrityHash: buildClinicalDocumentIntegrityHash(document),
      });
    }
  );
});
