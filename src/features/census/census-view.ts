// Dedicated lazy entrypoint for the initial census route.
//
// Keep this narrower than public-components: the first /censo render needs
// CensusView, not the global search or email configuration modals.
export { CensusView } from './components/CensusView';
export type { CensusMedicalHandoffActionContext } from './contracts/censusMedicalHandoffAction';
