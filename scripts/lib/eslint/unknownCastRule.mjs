import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `x as unknown as T` converts anything into anything, like an explicit `any`. Each production
// file keeps at most the count it had; the ceilings only go down.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const UNKNOWN_CAST_CEILINGS_PATH = 'scripts/config/unknown-cast-ceilings.json';
const UNKNOWN_CAST_CEILINGS = JSON.parse(
  readFileSync(new URL('../../config/unknown-cast-ceilings.json', import.meta.url), 'utf8')
).files;

export const unknownCastRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      grown:
        '«as unknown as» convierte cualquier valor en cualquier tipo sin comprobarlo. Este archivo tiene {{now}} y su techo es {{ceiling}} en ' +
        UNKNOWN_CAST_CEILINGS_PATH +
        '. Modela el tipo: un solo `as` si TypeScript lo acepta, una guarda de tipo, un tipo estrecho con nombre propio o el tipo que exporta la librería.',
      lower:
        'Este archivo bajó a {{now}} «as unknown as» (techo {{ceiling}}). Baja su techo en ' +
        UNKNOWN_CAST_CEILINGS_PATH +
        '; si llega a 0, quita la entrada.',
    },
  },
  create(context) {
    const file = path.relative(ROOT, context.filename).split(path.sep).join('/');
    const ceiling = UNKNOWN_CAST_CEILINGS[file] ?? 0;
    const isUnknownCast = node =>
      ['TSAsExpression', 'TSTypeAssertion'].includes(node.type) &&
      node.typeAnnotation.type === 'TSUnknownKeyword';
    const casts = [];
    const visit = node => isUnknownCast(node.expression) && casts.push(node);
    return {
      TSAsExpression: visit,
      TSTypeAssertion: visit,
      'Program:exit'(program) {
        const data = { now: casts.length, ceiling };
        if (casts.length > ceiling)
          casts.forEach(node => context.report({ node, messageId: 'grown', data }));
        else if (casts.length < ceiling)
          context.report({ node: program, messageId: 'lower', data });
      },
    };
  },
};

// `x as never` bypasses assignability checks just like `any`. Production source reached zero
// `as never` casts and stays at zero.
export const neverCastRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        '«as never» evita la comprobación de tipos igual que `any`. Modela el tipo real: usa una guarda de tipo, un tipo estrecho con nombre propio o el tipo que espera el contrato.',
    },
  },
  create(context) {
    const check = node => {
      if (node.typeAnnotation?.type === 'TSNeverKeyword') {
        context.report({ node, messageId: 'forbidden' });
      }
    };
    return {
      TSAsExpression: check,
      TSTypeAssertion: check,
    };
  },
};
