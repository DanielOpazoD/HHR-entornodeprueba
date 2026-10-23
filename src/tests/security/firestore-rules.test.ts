import { registerMigrationReleaseGuards } from './firestoreRulesMigrationReleaseGuards';
/* @flake-safe: Safe usage of Date for setup only */

import { registerFirestoreRulesAccessGroups } from './firestoreRulesAccessGroups';
import { registerClinicalDerivedRules } from './firestoreRulesClinicalDerived';
import { registerFirestoreRulesDomainGroups } from './firestoreRulesDomainGroups';
import { registerFirestoreRulesIdentityGroups } from './firestoreRulesIdentityGroups';
import { registerFirestoreRulesSuite } from './firestoreRulesTestHarness';
import { registerClinicalDocumentIntegrityRules } from './firestoreRulesClinicalDocumentIntegrity';
import { registerFirestoreRulesTemporalBoundaries } from './firestoreRulesTemporalBoundaries';

registerFirestoreRulesSuite(harness => {
  registerFirestoreRulesAccessGroups(harness);
  registerClinicalDerivedRules(harness);
  registerFirestoreRulesDomainGroups(harness);
  registerMigrationReleaseGuards(harness);
  registerFirestoreRulesIdentityGroups(harness);
  registerClinicalDocumentIntegrityRules(harness);
  registerFirestoreRulesTemporalBoundaries();
});
