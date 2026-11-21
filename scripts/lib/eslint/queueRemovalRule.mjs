// SAVE-03: queue rows and the local database are removed only in the modules whose tests prove when.
export const QUEUE_REMOVAL_HOMES = [
  'src/services/storage/sync/dexieSyncQueueStore.ts',
  'src/services/storage/sync/dexieSyncQueueAuthorityAck.ts',
  'src/services/storage/sync/dexieSyncQueueQuarantine.ts',
  'src/services/storage/indexeddb/indexedDbDeleteController.ts',
];

export const queueRemovalRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      removal:
        'Solo dexieSyncQueueStore, dexieSyncQueueAuthorityAck, dexieSyncQueueQuarantine e indexedDbDeleteController borran tareas de la cola o la base local (SAVE-03). Llama a sus funciones; nada borra la cola sin confirmación explícita.',
    },
  },
  create(context) {
    const nameOf = node =>
      node?.type === 'MemberExpression'
        ? node.computed
          ? node.property.value
          : node.property.name
        : undefined;
    const unwrap = node =>
      [
        'ChainExpression',
        'TSNonNullExpression',
        'TSAsExpression',
        'TSSatisfiesExpression',
      ].includes(node?.type)
        ? unwrap(node.expression)
        : node;
    // const names bound to the queue table: `const q = db.syncQueue`, `const { syncQueue } = db`,
    // `const t = db.table('syncQueue')`, and const aliases of those, resolved through the scope.
    // Not followed: let/reassignment, parameters, return values and collections.
    const aliases = new Set();
    const variableOf = node => {
      for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get(node.name);
        if (variable) return variable;
      }
      return undefined;
    };
    const reachesSyncQueue = node => {
      for (let current = unwrap(node); current; ) {
        if (current.type === 'Identifier') return aliases.has(variableOf(current));
        if (current.type === 'MemberExpression') {
          if (nameOf(current) === 'syncQueue') return true;
          current = unwrap(current.object);
        } else if (current.type === 'CallExpression') {
          const callee = unwrap(current.callee);
          if (nameOf(callee) === 'table' && current.arguments[0]?.value === 'syncQueue')
            return true;
          current = callee;
        } else return false;
      }
      return false;
    };
    const bindings = [];
    const removals = [];
    const bind = (target, value) => {
      if (!target || !value) return;
      if (target.type === 'AssignmentPattern') return bind(target.left, value);
      if (target.type === 'Identifier') return void bindings.push([target, value]);
      if (target.type !== 'ObjectPattern') return;
      for (const property of target.properties) {
        const key = property.type === 'Property' && !property.computed ? property.key : undefined;
        if (key?.name === 'syncQueue' || key?.value === 'syncQueue')
          bind(property.value, {
            type: 'MemberExpression',
            computed: true,
            property: { value: 'syncQueue' },
          });
      }
    };
    return {
      // Only const bindings: they cannot be reassigned, so an alias needs no flow analysis.
      VariableDeclarator: node => node.parent.kind === 'const' && bind(node.id, node.init),
      CallExpression(node) {
        const callee = unwrap(node.callee);
        const method = nameOf(callee);
        const object = unwrap(callee?.object);
        if (
          method === 'deleteDatabase' ||
          (method === 'delete' && ['Dexie', 'hospitalDB'].includes(object?.name))
        )
          context.report({ node, messageId: 'removal' });
        else if (['delete', 'bulkDelete', 'clear'].includes(method)) removals.push([node, object]);
      },
      'Program:exit'() {
        // First every const alias of the file, in any order (a closure may use one declared later).
        for (let size = -1; size !== aliases.size; ) {
          size = aliases.size;
          for (const [target, value] of bindings) {
            const variable = variableOf(target);
            if (variable && reachesSyncQueue(value)) aliases.add(variable);
          }
        }
        for (const [node, object] of removals) {
          if (reachesSyncQueue(object)) context.report({ node, messageId: 'removal' });
        }
      },
    };
  },
};
