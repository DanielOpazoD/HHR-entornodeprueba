// Narrow entrypoint for routes that only need the Google Sheets handoff action.
// Keep the full handoff view out of the initial census chunk.
export { MedicalHandoffSpreadsheetAction } from './components/MedicalHandoffSpreadsheetAction';
export {
  buildMedicalHandoffSpreadsheetRows,
  MEDICAL_HANDOFF_SPREADSHEET_MAX_ROWS,
} from './controllers/medicalHandoffSpreadsheetController';
