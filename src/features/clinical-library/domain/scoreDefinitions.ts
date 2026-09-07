/**
 * Índice de scores clínicos. Cada score vive en `scores/<nombre>.ts` con sus ítems,
 * puntos de corte publicados y referencia; los tests anclan puntajes y bandas.
 */

import type { ScoreDefinition } from './scoreEngine';
import { CAM_ICU } from './scores/camIcu';
import { CHA2DS2VASC } from './scores/cha2ds2vasc';
import { CURB65 } from './scores/curb65';
import { GLASGOW } from './scores/glasgow';
import { NEWS2 } from './scores/news2';
import { PADUA } from './scores/padua';
import { QSOFA } from './scores/qsofa';
import { SAS } from './scores/sas';
import { WELLS_PE } from './scores/wellsPe';

export const SCORE_DEFINITIONS: ReadonlyArray<ScoreDefinition> = [
  NEWS2,
  QSOFA,
  GLASGOW,
  SAS,
  CAM_ICU,
  CURB65,
  WELLS_PE,
  PADUA,
  CHA2DS2VASC,
];

export const findScoreDefinition = (id: string): ScoreDefinition | undefined =>
  SCORE_DEFINITIONS.find(definition => definition.id === id);
