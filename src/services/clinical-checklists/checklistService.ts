import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

export interface ChecklistField {
  id: string;
  label: string;
  type: 'text' | 'date' | 'time' | 'positive-integer' | 'choice';
  required: boolean;
  options?: { label: string; points?: number }[];
  requiredWhen?: { field: string; equals: string } | null;
}
export interface ChecklistTemplate {
  id: string;
  title: string;
  version: number;
  fields: ChecklistField[];
}
export interface ChecklistRecord {
  code: string;
  savedAt: string;
  authorName: string;
  patient: { name: string; document: string; episode: string };
  template: ChecklistTemplate;
  evolution: string;
}
type Request =
  | { action: 'templates' }
  | { action: 'get'; code: string }
  | { action: 'configure'; template: ChecklistTemplate; version: number }
  | {
      action: 'apply';
      code: string;
      episode: string;
      document: string;
      uid: string;
      templateId: string;
      version: number;
      answers: Record<string, string>;
    };
interface Results {
  templates: { templates: ChecklistTemplate[]; manage: boolean; uid: string; authorName: string };
  get: { record: ChecklistRecord };
  apply: { record: ChecklistRecord };
  configure: { template: ChecklistTemplate };
}
export async function clinicalChecklist<T extends Request>(data: T): Promise<Results[T['action']]> {
  const functions = await defaultFunctionsRuntime.getRegionalFunctions('southamerica-east1');
  const callable = httpsCallable<T, Results[T['action']]>(functions, 'clinicalChecklists', {
    timeout: 25000,
  });
  return (await callable(data)).data;
}
export type ExtensionChecklistRequest = Extract<Request, { action: 'templates' | 'apply' }>;
