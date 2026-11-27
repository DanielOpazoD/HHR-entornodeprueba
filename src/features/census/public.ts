// Public API for code outside the census feature. Internal consumers should import local modules directly.
//
// Heavy components intentionally live behind lazy entrypoints so this barrel can
// be imported statically without pulling the component tree into the
// authenticated-shell chunk.
type LoadCensusChunk = () => Promise<unknown>;

export const preloadCensusComponentsChunk = (
  loadCensusComponents: LoadCensusChunk = () => import('./census-view')
): Promise<unknown> => loadCensusComponents();

export { CensusOperationalStateBanner } from './components/CensusOperationalStateBanner';
export { resolveCensusOperationalState } from './controllers/censusOperationalStateController';
export type { CensusAccessProfile } from '@/shared/access/censusAccessProfile';
export { isSpecialistCensusAccessProfile } from '@/shared/access/censusAccessProfile';
export type {
  ClinicalDocSummary,
  EpisodeDocuments,
  SelectedPatientDetail,
  UseGlobalPatientSearchReturn,
} from './components/global-search/globalSearchContracts';
