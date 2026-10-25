import path from 'node:path';
import ts from 'typescript';
import { OFFLINE_BOOT_CHUNKS } from './pwaPrecacheGraph';

const GUARDED_TARGETS: Record<string, string> = {
  'src/app-shell/runtime/AuthenticatedAppShell': 'app-authenticated-shell',
  'src/components/bookmarks/BookmarkBar': 'BookmarkBar',
  'src/components/clinical-conflicts/CensusConflictQuickAction': 'CensusConflictQuickAction',
  'src/components/layout/app-content/AppContentOverlays': 'AppContentOverlays',
  'src/components/layout/date-strip/DateStripBookmarkToggle': 'app-authenticated-shell',
  'src/components/layout/date-strip/DateStripMonthNavigator': 'DateStripMonthNavigator',
  'src/components/layout/date-strip/DateStripQuickActions': 'DateStripQuickActions',
  'src/components/layout/date-strip/DateStripYearNavigator': 'DateStripYearNavigator',
  'src/components/layout/date-strip/actions/EmailDropdown': 'EmailDropdown',
  'src/components/layout/date-strip/actions/PdfButtons': 'PdfButtons',
  'src/components/layout/date-strip/actions/SaveDropdown': 'SaveDropdown',
  'src/components/layout/navbar/MoaHelpButton': 'MoaHelpButton',
  'src/components/reminders/ReminderBadge': 'ReminderBadge',
  'src/components/ui/FunctionsRecoveryNotice': 'FunctionsRecoveryNotice',
  'src/features/census/census-view': 'census-view',
  'src/features/census/components/CensusModals': 'CensusModals',
  'src/features/census/components/CensusRegisterContent': 'census-view',
  'src/features/census/components/CensusRegisterSections': 'CensusRegisterSections',
  'src/features/census/components/EmptyDayPrompt': 'EmptyDayPrompt',
  'src/features/census/components/patient-row/PatientRowOrbitalQuickActionsPortal':
    'PatientRowOrbitalQuickActionsPortal',
  'src/features/clinical-library/quick-action': 'quick-action',
  'src/features/laboratory/quick-action': 'quick-action',
};

// Exact targets only. A new mount must declare its offline root or explain why it is optional.
const OPTIONAL_TARGETS: Record<string, string> = {
  'src/application/clinical-documents/clinicalDocumentUseCases':
    'Document presence lookup has its own loading/error state.',
  'src/components/debug/TestAgent': 'Debug panel opens only on request.',
  'src/components/layout/MoaCompanion':
    'Moa has an isolated error boundary and explicit recovery action.',
  'src/components/layout/NursingPasswordDialog': 'Password dialog opens from the user menu.',
  'src/components/layout/UserAvatarModal': 'Avatar editor opens on request.',
  'src/components/layout/UserMenuPanel': 'User menu opens on request.',
  'src/components/layout/date-strip/MedicalIndicationsDialog':
    'Indications editor opens on request.',
  'src/components/layout/date-strip/actions/HandoffSaveDropdown':
    'Handoff toolbar belongs to another route.',
  'src/components/modals/DemographicsModal': 'Demographics dialog opens on request.',
  'src/components/modals/ExamRequestModal': 'Exam form opens on request.',
  'src/components/modals/ImagingRequestDialog': 'Imaging form opens on request.',
  'src/components/modals/PatientHistoryModal': 'History opens on request.',
  'src/components/modals/RadiologyViewerModal':
    'Imaging viewer opens on request and needs online images.',
  'src/components/reminders/ReminderModal': 'Reminder editor opens on request.',
  'src/components/shared/ExcelViewerModal': 'Shared census export preview opens on request.',
  'src/context/ReminderCenterContext':
    'Deferred reminder provider has a local fallback if unavailable.',
  'src/features/census/components/FugaNotificationModal':
    'Fuga notification can mount on first paint; failures stay inside Altas del Día.',
  'src/features/census/components/PatientHospitalizationReportsDialog':
    'Reports open on request with a local error boundary.',
  'src/features/census/components/StaffShiftDetailsModal': 'Staff detail dialog opens on request.',
  'src/features/census/components/patient-row/ClinicalPanelAntecedents':
    'Part of the online clinical drawer.',
  'src/features/census/components/patient-row/ClinicalPanelDrawer':
    'Online clinical drawer opens on request with a local boundary.',
  'src/features/census/components/patient-row/DiagnosisCie10Cell':
    'Opt-in CIE10 mode is tracked separately; free-text census is the offline baseline.',
  'src/features/census/components/patient-row/PatientActionMenuPanel': 'Row menu opens on request.',
  'src/features/census/components/patient-row/PatientDocumentManagerDialog':
    'Document manager opens from the clinical drawer.',
  'src/features/census/components/patient-row/PatientRowModals':
    'Row dialogs mount only when a dialog is selected.',
  'src/features/census/components/patient-row/ScoresDetailModal': 'Score detail opens on request.',
  'src/features/census/components/patient-row/VitalsDetailModal': 'Vitals detail opens on request.',
  'src/features/census/components/specialty-round/SpecialtyRoundEntry':
    'Specialty dialog opens on request.',
  'src/features/census/components/specialty-round/SpecialtyRoundWindow':
    'Specialty round opens on request.',
  'src/features/census/components/specialty-round/SpecialtyRulesWindow':
    'Specialty rules open on request.',
  'src/features/census/public-components': 'Global search opens on request.',
  'src/features/clinical-documents': 'Clinical document dialogs/export open on request.',
  'src/features/cudyr': 'Monthly summary is an explicit alternate view.',
  'src/features/laboratory': 'Online laboratory viewer opens on request.',
  'src/features/rayen-import/RayenImportButton':
    'Online Eloisa import has an isolated toolbar fallback.',
  'src/features/rayen-manual-import': 'Manual import dialog opens on request.',
  'src/hooks/admin/SystemHealthReporterBridge':
    'Optional deferred diagnostics are caught by their loader.',
  'src/services/auth/authAccessResolution':
    'Authorization lookup for an explicit specialty action.',
  'src/services/exporters/censusMasterExport': 'Export starts only on request.',
  'src/services/firebase-runtime/authRuntime':
    'Authorization lookup for an explicit specialty action.',
  'src/services/patient/patientHistoryService': 'History reads start on patient selection.',
  'src/services/patient/patientUpcHistoryService':
    'UPC history has an independent loading/error state.',
  'src/services/pdf/antecedentPrescriptionPdf': 'PDF export starts only on request.',
  'src/services/pdf/medicalIndicationsPdfService': 'PDF export starts only on request.',
  'src/services/repositories/ClinicalDocumentRepository':
    'Document history reads start on patient selection.',
  'src/services/repositories/dailyRecordClinicalDerivedReadService':
    'Vitals history has its own loading/error state.',
  'src/services/specialty/specialtyJevClient':
    'Online specialty dialog retains its manual assignment fallback.',
  'src/services/storage/firestore/firestoreRecordQueries':
    'Online specialty rule reads have their own error state.',
};

export interface FirstPaintSource {
  file: string;
  source: string;
}

export const assertFirstPaintLazyCoverage = (sources: readonly FirstPaintSource[]) => {
  const violations: string[] = [];
  for (const { file, source } of sources) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const declarations = new Map<string, ts.Node>();
    const index = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        declarations.set(node.name.text, node.initializer);
      }
      if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
      ts.forEachChild(node, index);
    };
    index(ast);
    const importTargets = (node: ts.Node, seen = new Set<ts.Node>()): string[] => {
      if (seen.has(node)) return [];
      seen.add(node);
      if (ts.isIdentifier(node)) {
        const declaration = declarations.get(node.text);
        if (declaration) return importTargets(declaration, seen);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const target = node.arguments[0];
        return target && ts.isStringLiteralLike(target) ? [target.text] : ['<nonliteral import>'];
      }
      const targets: string[] = [];
      ts.forEachChild(node, child => {
        targets.push(...importTargets(child, seen));
      });
      return targets;
    };
    const classify = (target: string, node: ts.Node) => {
      const resolved = path.posix.normalize(
        target.startsWith('@/')
          ? `src/${target.slice(2)}`
          : path.posix.join(path.posix.dirname(file), target)
      );
      const root = GUARDED_TARGETS[resolved];
      if (root && OFFLINE_BOOT_CHUNKS.includes(root)) return;
      if (OPTIONAL_TARGETS[resolved]?.trim()) return;
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      violations.push(
        `${file}:${line}: ${target}. Configure an offline guard root or an optional mount with a reason.`
      );
    };
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          importTargets(node).forEach(target => classify(target, node));
        } else {
          const name = ts.isIdentifier(node.expression)
            ? node.expression.text
            : ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name.text
              : '';
          if (name === 'lazy' || name === 'lazyWithRetry') {
            const targets = node.arguments[0] ? importTargets(node.arguments[0]) : [];
            if (!targets.length) classify('<unclassified lazy loader>', node);
            targets.forEach(target => classify(target, node));
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  if (violations.length)
    throw new Error(
      `Unclassified first-paint lazy mounts:\n${[...new Set(violations)].join('\n')}`
    );
};
