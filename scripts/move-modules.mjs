#!/usr/bin/env node
// Moves files or folders with `git mv` and rewrites every path that names them, so a move never
// leaves a stale `vi.mock` (which would let a test pass silently) or a config entry behind.
//
//   node scripts/move-modules.mjs [--check] [--reviewed] [--plan plan.json] [<from> <to>]...
//
// The plan file is a JSON list of `{ "from": "...", "to": "..." }` or `["from", "to"]` pairs.
// `--check` changes nothing and prints what it would do.
//
// Rewritten, in every tracked or untracked (not ignored) text file:
// - in code, every string literal that starts with `./`, `../`, `@/` or `/` and resolves to a moved
//   file: imports, `import()` (also through a variable), `vi.mock`, `vi.doMock`, `vi.unmock`,
//   `vi.importActual`, `require`, `new Worker(new URL(...))`, path strings. Each keeps its style:
//   relative stays relative (recomputed when the importing file moves too), alias stays alias,
//   without extension stays without, a folder import stays a folder import. A relative import that
//   ends up crossing between a feature (`src/features/<name>`) and the rest of `src/` becomes `@/`,
//   because the boundary rules read the alias;
// - in Markdown, relative links to a moved file or folder; a table it touches is reformatted
//   with the repository's Prettier, and nothing else in the file is;
// - anywhere, the path written from the repository root (`src/a/b.ts`, `src/a/b`, `/src/a/b.ts`,
//   globs under a moved folder) and its `@/` form.
// Refused, naming each one: an old path left in a form it cannot rewrite (a glob such as
// `src/a/b*.ts`). Nothing changes while one is left.
// Refused until `--reviewed`, also by `--check`: a regular expression in code that names an old
// path (`/@\/a\/b['"]/`). A guard written that way would silently pass after the move.
// To review, listed by `--check` and required to be acknowledged with `--reviewed`:
// - a folder outside Markdown that held a moved file and no longer holds it, or that will now
//   hold one (coverage zones, chunk selection, ESLint globs, folder rules): the move changes what
//   that rule applies to;
// - a link, in Markdown too, to a folder the move leaves empty;
// - the moved file's name in a path the tool could not resolve (`utils/b.ts`).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const posix = path.posix;
const CODE_FILE = /\.(?:m|c)?[jt]sx?$/;
const MARKDOWN_FILE = /\.mdx?$/;
const STRIPPABLE_EXTENSION = /(?:\.d\.ts|\.(?:m|c)?[jt]sx?|\.json)$/;
const RESOLVE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.mts',
  '.cts',
  '.json',
  '.d.ts',
];
const MAX_TEXT_BYTES = 4_000_000;
// A string literal whose content starts like a module path; template literals with `${` are skipped.
const PATH_LITERAL = /(['"`])((?:\.{1,2}\/|\.{1,2}(?=\1)|@\/|\/(?!\/))[^'"`\n$]*)\1/g;
const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)>?/g;
// A path starts at a boundary: not inside a word, and not after another folder (`functions/src`).
const PATH_START = '(?<![\\w\\-.]|[\\w\\-]/)';
const PATH_CHAR = /[\w\-.@/]/;
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripExtension = filePath => filePath.replace(STRIPPABLE_EXTENSION, '');
const aliasOf = filePath => (filePath.startsWith('src/') ? `@/${filePath.slice(4)}` : null);
const lineOf = (text, offset) => text.slice(0, offset).split('\n').length;
const ancestorsOf = file => {
  const list = [];
  for (let folder = posix.dirname(file); folder !== '.'; folder = posix.dirname(folder))
    list.push(folder);
  return list;
};
// `src/features/<name>` for a feature file, `src` for the rest of `src/`, null outside it.
const ownerOf = file =>
  file.match(/^src\/features\/[^/]+(?=\/)/)?.[0] ?? (file.startsWith('src/') ? 'src' : null);
const crossesFeatureBoundary = (importer, target) =>
  ownerOf(importer) !== null && ownerOf(target) !== null && ownerOf(importer) !== ownerOf(target);

// Thrown, not `process.exit`: exiting at once can cut what stdout still had to print to a pipe.
class Refusal extends Error {}
const fail = message => {
  throw new Refusal(message);
};

const parseArguments = argv => {
  const options = { check: false, reviewed: false, planFile: null, pairs: [] };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--check') options.check = true;
    else if (argv[index] === '--reviewed') options.reviewed = true;
    else if (argv[index] === '--plan') options.planFile = argv[(index += 1)];
    else positional.push(argv[index]);
  }
  if (positional.length % 2 !== 0) fail('every <from> needs its <to>.');
  for (let index = 0; index < positional.length; index += 2) {
    options.pairs.push({ from: positional[index], to: positional[index + 1] });
  }
  if (options.planFile) {
    for (const entry of JSON.parse(fs.readFileSync(options.planFile, 'utf8'))) {
      options.pairs.push(Array.isArray(entry) ? { from: entry[0], to: entry[1] } : entry);
    }
    options.planFile = posix.relative(process.cwd(), path.resolve(options.planFile));
  }
  if (options.pairs.length === 0) {
    fail(
      'nothing to move. Usage: move-modules.mjs [--check] [--reviewed] [--plan plan.json] <from> <to>...'
    );
  }
  const normalize = value =>
    posix.normalize(String(value).replaceAll('\\', '/')).replace(/\/$/, '');
  options.pairs = options.pairs.map(({ from, to }) => ({
    from: normalize(from),
    to: normalize(to),
  }));
  return options;
};

const listRepositoryFiles = () => [
  ...new Set(
    execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    })
      .split('\0')
      .filter(file => file && fs.existsSync(file) && fs.statSync(file).isFile())
  ),
];

/** Maps each moved file to its destination; folder moves are also kept for prefix rewriting. */
const buildMoves = (pairs, files, fileSet) => {
  const moved = new Map();
  const folders = [];
  for (const { from, to } of pairs) {
    if (from === to || to.startsWith(`${from}/`)) fail(`${to} is ${from} or inside it.`);
    if (fileSet.has(from)) {
      moved.set(from, to);
      continue;
    }
    const inside = files.filter(file => file.startsWith(`${from}/`));
    if (inside.length === 0) fail(`${from} is not a file or folder of the repository.`);
    for (const file of inside) moved.set(file, to + file.slice(from.length));
    folders.push({ from, to });
  }
  const destinations = new Set();
  for (const [from, to] of moved) {
    if (destinations.has(to)) fail(`two paths would move to ${to}.`);
    if (fileSet.has(to) && !moved.has(to)) fail(`${to} already exists (moving ${from}).`);
    destinations.add(to);
  }
  return { moved, folders };
};

const createResolver = fileSet => specifierPath => {
  const clean = posix.normalize(specifierPath);
  if (fileSet.has(clean)) return { target: clean, form: 'exact' };
  const tsTwin = clean.replace(/\.(m|c)?js(x?)$/, '.$1ts$2');
  if (tsTwin !== clean && fileSet.has(tsTwin)) return { target: tsTwin, form: 'twin' };
  for (const extension of RESOLVE_EXTENSIONS) {
    if (fileSet.has(clean + extension)) return { target: clean + extension, form: 'bare' };
  }
  for (const extension of RESOLVE_EXTENSIONS) {
    const index = `${clean === '.' ? '' : `${clean}/`}index${extension}`;
    if (fileSet.has(index)) return { target: index, form: 'folder' };
  }
  return null;
};

/** Writes the new target in the form the old specifier used. */
const formatTarget = (newTarget, form, oldSpecifierPath) => {
  if (form === 'exact') return newTarget;
  if (form === 'twin') return stripExtension(newTarget) + posix.extname(oldSpecifierPath);
  if (form === 'folder' && posix.basename(newTarget).startsWith('index.'))
    return posix.dirname(newTarget);
  return stripExtension(newTarget);
};

const specifierBase = (specifierPath, importer) => {
  if (specifierPath.startsWith('@/')) return `src/${specifierPath.slice(2)}`;
  if (specifierPath.startsWith('/')) return specifierPath.slice(1);
  return posix.join(posix.dirname(importer), specifierPath);
};

const rewriteSpecifier = (specifier, importer, newImporter, resolve, moved) => {
  const [specifierPath, query = ''] = specifier.split(/(?=[?#])/, 2);
  const resolved = resolve(specifierBase(specifierPath, importer));
  if (!resolved) return null;
  const relativeStyle = specifierPath.startsWith('.');
  const newTarget = moved.get(resolved.target) ?? resolved.target;
  if (newTarget === resolved.target && (!relativeStyle || newImporter === importer)) return null;
  const written = formatTarget(newTarget, resolved.form, specifierPath);
  if (specifierPath.startsWith('/')) return `/${written}${query}`;
  if (specifierPath.startsWith('@/') && aliasOf(written)) return aliasOf(written) + query;
  if (crossesFeatureBoundary(newImporter, newTarget) && aliasOf(written))
    return aliasOf(written) + query;
  let relative = posix.relative(posix.dirname(newImporter), written === '.' ? '' : written) || '.';
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative + query;
};

const splitMarkdownLink = (target, file) => {
  if (/^[a-z][a-z0-9+.-]*:|^[#/]/i.test(target)) return null;
  const [linkPath, suffix = ''] = target.split(/(?=[#?])|(?=:\d)/, 2);
  return { absolute: posix.normalize(posix.join(posix.dirname(file), linkPath)), suffix };
};

const rewriteMarkdownLink = (target, file, newFile, context) => {
  const link = splitMarkdownLink(target, file);
  if (!link) return null;
  const { absolute, suffix } = link;
  let newAbsolute;
  if (context.fileSet.has(absolute)) newAbsolute = context.moved.get(absolute) ?? absolute;
  else if (context.folderSet.has(absolute)) {
    const folder = context.folders.find(
      ({ from }) => absolute === from || absolute.startsWith(`${from}/`)
    );
    newAbsolute = folder ? folder.to + absolute.slice(folder.from.length) : absolute;
  } else return null;
  if (newAbsolute === absolute && newFile === file) return null;
  return (posix.relative(posix.dirname(newFile), newAbsolute) || '.') + suffix;
};

/**
 * One alternation of every old path form, longest first. A file form must not continue as another
 * file (`a.test.ts`, `a/`); a folder form may continue with `/`. The `leftover` variant also
 * matches what the rewrite leaves alone: a glob `*` right after the path.
 */
const buildPathPattern = (moved, folders, mode) => {
  const forms = new Map();
  const addForm = (oldPath, newPath, kind) => {
    forms.set(oldPath, { newPath, kind });
    if (aliasOf(oldPath)) forms.set(aliasOf(oldPath), { newPath: aliasOf(newPath), kind });
  };
  for (const [from, to] of moved) {
    if (folders.some(folder => from.startsWith(`${folder.from}/`))) continue;
    addForm(from, to, 'file');
    if (stripExtension(from) !== from) addForm(stripExtension(from), stripExtension(to), 'file');
  }
  for (const { from, to } of folders) addForm(from, to, 'folder');
  const glob = mode === 'rewrite' ? '*' : '';
  const alternatives = [...forms.keys()]
    .sort((left, right) => right.length - left.length)
    .map(form => {
      const slash = forms.get(form).kind === 'file' ? '/' : '';
      return `${escapeRegExp(form)}(?![\\w\\-${slash}${glob}]|\\.\\w)`;
    });
  return { forms, pattern: new RegExp(`${PATH_START}(?:${alternatives.join('|')})`, 'g') };
};

/**
 * Folders whose content the move changes, so a rule scoped to them changes reach: `lost` held a
 * moved file and will not hold it (`emptied` when nothing is left), `gained` already exists and
 * will hold one. Folders inside a folder that moves whole are rewritten instead.
 */
const buildFolderChanges = (moved, folders, files, folderSet) => {
  const lost = new Map();
  const gained = new Map();
  const note = (map, folder, file) => {
    for (const form of [folder, aliasOf(folder)].filter(Boolean)) {
      if (!map.has(form)) map.set(form, new Set());
      map.get(form).add(file);
    }
  };
  for (const [from, to] of moved) {
    for (const folder of ancestorsOf(from)) {
      if (to.startsWith(`${folder}/`)) break;
      if (folders.some(moving => folder === moving.from || folder.startsWith(`${moving.from}/`)))
        continue;
      note(lost, folder, from);
    }
    for (const folder of ancestorsOf(to)) {
      if (from.startsWith(`${folder}/`)) break;
      if (folderSet.has(folder)) note(gained, folder, from);
    }
  }
  const emptied = new Set(
    [...lost.keys()].filter(
      folder =>
        !folder.startsWith('@/') &&
        files.every(file => !file.startsWith(`${folder}/`) || moved.has(file)) &&
        ![...moved.values()].some(to => to.startsWith(`${folder}/`))
    )
  );
  return { lost, gained, emptied };
};

/** Matches any of `folderForms` as a whole path, alone or followed by `/`, `/*` or `/**` and a glob. */
const buildFolderPattern = folderForms => {
  if (folderForms.length === 0) return null;
  const alternatives = [...folderForms]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  const tail = '(?:/\\*{1,2}(?:/[\\w.{},*\\-]*)?|/)?(?![\\w\\-/*]|\\.\\w)';
  return new RegExp(`${PATH_START}(${alternatives.join('|')})${tail}`, 'g');
};

/**
 * A run of path characters with an escaped slash (`@\/a\/b`, `'a\\/b'`), read as a path: a regular
 * expression or a RegExp string that names a path. Its escapes are dropped before comparing.
 */
const ESCAPED_PATH = /[\w\-.@\\/]*\\\/[\w\-.@\\/]*/g;
const OLD_PATH_IN_ESCAPED = old => {
  const forms = [...old];
  return token => {
    const segments = token
      .replace(/\\+[A-Za-z]/g, '')
      .replaceAll('\\', '')
      .split('/')
      .filter(segment => segment && segment !== '.' && segment !== '..');
    if (segments[0] === '@') segments[0] = 'src';
    if (segments.length < 2) return null;
    const written = `/${segments.join('/')}`;
    return forms.find(form => `/${form}`.endsWith(written) || written.endsWith(`/${form}`)) ?? null;
  };
};

/** The moved file's own name inside a path-like token the rewrite did not touch. */
const buildNamePattern = (moved, files) => {
  const count = new Map();
  for (const file of files)
    count.set(posix.basename(file), (count.get(posix.basename(file)) ?? 0) + 1);
  const names = [...moved.keys()]
    .map(file => posix.basename(file))
    .filter(name => count.get(name) === 1 && stripExtension(name).length >= 6);
  if (names.length === 0) return null;
  const stems = [...new Set(names.map(stripExtension))].map(escapeRegExp).join('|');
  const extension = '\\.(?:d\\.ts|[mc]?[jt]sx?|json)';
  // After a slash (`lib/b`, `lib/b.ts`), or quoted alone with its extension (`path.join(..., 'b.ts')`).
  const afterSlash = `(?<=/)(?:${stems})(?:${extension})?`;
  const quoted = `(?<=['"\`])(?:${stems})${extension}(?=['"\`])`;
  return new RegExp(`(?:${afterSlash}|${quoted})(?![\\w\\-]|\\.\\w)`, 'g');
};

const tokenAround = (text, start, end) => {
  let left = start;
  let right = end;
  while (left > 0 && PATH_CHAR.test(text[left - 1])) left -= 1;
  while (right < text.length && /[\w\-.]/.test(text[right])) right += 1;
  return { left, right, token: text.slice(left, right).replace(/\.$/, '') };
};

const readText = file => {
  const buffer = fs.readFileSync(file);
  return buffer.length > MAX_TEXT_BYTES || buffer.includes(0) ? null : buffer.toString('utf8');
};

const lineText = (text, offset) => {
  const end = text.indexOf('\n', offset);
  return text.slice(text.lastIndexOf('\n', offset) + 1, end === -1 ? undefined : end).trim();
};

const planMove = ({ pairs, planFile }) => {
  const files = listRepositoryFiles();
  const fileSet = new Set(files);
  const folderSet = new Set();
  for (const file of files) {
    for (let folder = posix.dirname(file); folder !== '.'; folder = posix.dirname(folder))
      folderSet.add(folder);
  }
  const topFolders = new Set(files.map(file => file.split('/')[0]));
  const { moved, folders } = buildMoves(pairs, files, fileSet);
  const context = { fileSet, folderSet, moved, folders };
  const resolve = createResolver(fileSet);
  const rewrite = buildPathPattern(moved, folders, 'rewrite');
  const leftover = buildPathPattern(moved, folders, 'leftover');
  const { lost, gained, emptied } = buildFolderChanges(moved, folders, files, folderSet);
  const folderPattern = buildFolderPattern([...new Set([...lost.keys(), ...gained.keys()])]);
  const folderReason = (form, written) => {
    const examples = map => [...map.get(form)].slice(0, 2).join(', ');
    if (emptied.has(form.replace(/^@\//, 'src/')))
      return `folder ${written} will be empty after the move (it held ${examples(lost)})`;
    if (lost.has(form)) return `folder ${written} will no longer hold ${examples(lost)}`;
    return `folder ${written} will now also hold ${examples(gained)}`;
  };
  const oldPathIn = OLD_PATH_IN_ESCAPED(
    new Set([
      ...[...moved.keys()].flatMap(file => [file, stripExtension(file)]),
      ...folders.map(({ from }) => from),
      ...emptied,
    ])
  );
  const namePattern = buildNamePattern(moved, files);
  const result = { moved, changes: [], writes: [], leftovers: [], regexes: [], review: [] };

  for (const file of files) {
    if (file === planFile) continue;
    const text = readText(file);
    if (text === null) continue;
    const newFile = moved.get(file) ?? file;
    const edits = [];
    const covered = (start, end) => edits.some(edit => start < edit.end && end > edit.start);
    const addEdit = (start, end, replacement) => {
      if (replacement !== null && replacement !== text.slice(start, end) && !covered(start, end)) {
        edits.push({ start, end, replacement });
      }
    };
    if (CODE_FILE.test(file)) {
      for (const match of text.matchAll(PATH_LITERAL)) {
        const start = match.index + 1;
        addEdit(
          start,
          start + match[2].length,
          rewriteSpecifier(match[2], file, newFile, resolve, moved)
        );
      }
    }
    if (MARKDOWN_FILE.test(file)) {
      for (const match of text.matchAll(MARKDOWN_LINK)) {
        const start = match.index + match[0].indexOf(match[1]);
        addEdit(
          start,
          start + match[1].length,
          rewriteMarkdownLink(match[1], file, newFile, context)
        );
        const linked = splitMarkdownLink(match[1], file)?.absolute.replace(/\/$/, '');
        if (emptied.has(linked)) {
          result.review.push({
            file,
            line: lineOf(text, start),
            reason: `link ${match[1]} points to a folder the move leaves empty`,
            text: lineText(text, start),
          });
        }
      }
    }
    for (const match of text.matchAll(rewrite.pattern)) {
      addEdit(match.index, match.index + match[0].length, rewrite.forms.get(match[0]).newPath);
    }
    if (folderPattern && !MARKDOWN_FILE.test(file)) {
      for (const match of text.matchAll(folderPattern)) {
        // A folder that only gains a file matters to controls; app code naming it is an import.
        if (!lost.has(match[1]) && /^src\/(?!tests\/)(?!.*\.(?:test|spec)\.)/.test(file)) continue;
        result.review.push({
          file,
          line: lineOf(text, match.index),
          reason: folderReason(match[1], match[0]),
          text: lineText(text, match.index),
        });
      }
    }
    const escapedPaths = [];
    if (CODE_FILE.test(file) && text.includes('\\/')) {
      for (const match of text.matchAll(ESCAPED_PATH)) {
        const oldPath = oldPathIn(match[0]);
        if (!oldPath) continue;
        escapedPaths.push({ start: match.index, end: match.index + match[0].length });
        result.regexes.push({
          file,
          line: lineOf(text, match.index),
          path: oldPath,
          text: lineText(text, match.index),
        });
      }
    }
    if (namePattern) {
      for (const match of text.matchAll(namePattern)) {
        // The name is unique in the repository, so a partial path ending in it (`controllers/b.ts`,
        // `/repo/src/a/b.ts`, `\/b\.ts`, a `path.join` segment) is a reference the rewrite cannot
        // place. Full paths from the root or `@/` were rewritten above, or name a deleted file.
        const { left, right, token } = tokenAround(
          text,
          match.index,
          match.index + match[0].length
        );
        if (covered(left, right) || token.startsWith('@/') || topFolders.has(token.split('/')[0]))
          continue;
        if (escapedPaths.some(range => left < range.end && right > range.start)) continue;
        if (/^\.{0,2}\//.test(token) && resolve(specifierBase(token, file))) continue;
        result.review.push({
          file,
          line: lineOf(text, match.index),
          reason: `path ${token} names a moved file and was not rewritten`,
          text: lineText(text, match.index),
        });
      }
    }

    edits.sort((left, right) => left.start - right.start);
    let next = '';
    let cursor = 0;
    for (const edit of edits) {
      next += text.slice(cursor, edit.start) + edit.replacement;
      cursor = edit.end;
      result.changes.push({
        file,
        line: lineOf(text, edit.start),
        from: text.slice(edit.start, edit.end),
        to: edit.replacement,
      });
    }
    next += text.slice(cursor);
    if (edits.length > 0) {
      // A path holds no line break, so the edited lines keep their numbers in the new text.
      const lines = new Set(edits.map(edit => lineOf(text, edit.start)));
      result.writes.push({ source: file, path: newFile, content: next, lines });
    }
    for (const match of next.matchAll(leftover.pattern)) {
      result.leftovers.push({
        file: newFile,
        line: lineOf(next, match.index),
        path: match[0],
        text: lineText(next, match.index),
      });
    }
  }
  return result;
};

/**
 * Reformats, with the repository's Prettier, each Markdown table (lines starting with `|`) that
 * holds an edited line, so a longer path does not leave it misaligned. The rest stays byte for byte.
 */
const formatTouchedTables = async (content, lines, sourceFile) => {
  const prettier = await import('prettier');
  const absolute = path.resolve(sourceFile);
  if ((await prettier.getFileInfo(absolute, { ignorePath: '.prettierignore' })).ignored)
    return content;
  const options = { ...(await prettier.resolveConfig(absolute)), parser: 'markdown' };
  const rows = content.split('\n');
  const output = [];
  for (let index = 0; index < rows.length; ) {
    if (!rows[index].startsWith('|')) {
      output.push(rows[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end].startsWith('|')) end += 1;
    const table = rows.slice(index, end);
    const touched = table.some((_, offset) => lines.has(index + offset + 1));
    output.push(
      ...(touched
        ? (await prettier.format(`${table.join('\n')}\n`, options)).replace(/\n$/, '').split('\n')
        : table)
    );
    index = end;
  }
  return output.join('\n');
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const { moved, changes, writes, leftovers, regexes, review } = planMove(options);
  for (const { from, to } of options.pairs)
    console.log(`${options.check ? 'would move' : 'move'} ${from} → ${to}`);
  for (const change of changes)
    console.log(`  ${change.file}:${change.line}  ${change.from} → ${change.to}`);
  console.log(
    `${changes.length} references rewritten in ${writes.length} files; ${moved.size} files moved.`
  );
  if (review.length > 0) {
    console.log(`\nTo review by hand (${review.length}): the move changes what these apply to.`);
    for (const item of review)
      console.log(`  ${item.file}:${item.line}  ${item.reason}  (${item.text})`);
  }
  const refusals = [
    ['these references name a moved path in a form it cannot rewrite', leftovers],
    ['these regular expressions name a moved path', regexes],
  ];
  for (const [title, items] of refusals.filter(([, items]) => items.length > 0)) {
    console.error(`\nmove-modules: ${title}:`);
    for (const item of items)
      console.error(`  ${item.file}:${item.line}  ${item.path}  (${item.text})`);
  }
  if (leftovers.length > 0) {
    fail(
      'write each one as a plain path or a glob of its folder, then run again. Nothing was changed.'
    );
  }
  if (regexes.length > 0 && !options.reviewed) {
    fail(
      'rewrite each regular expression by hand for the new path, then run again, or run with --reviewed after checking them. Nothing was changed.'
    );
  }
  if (options.check) return;
  if (review.length > 0 && !options.reviewed) {
    fail(
      'review the list above (coverage zones, chunk rules, ESLint globs), then run again with --reviewed. Nothing was changed.'
    );
  }
  for (const { from, to } of options.pairs) {
    fs.mkdirSync(posix.dirname(to), { recursive: true });
    execFileSync('git', ['mv', from, to], { stdio: 'inherit' });
  }
  for (const write of writes) {
    const content = MARKDOWN_FILE.test(write.path)
      ? await formatTouchedTables(write.content, write.lines, write.source)
      : write.content;
    fs.writeFileSync(write.path, content);
  }
};

try {
  await main();
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  console.error(`move-modules: ${error.message}`);
  process.exitCode = 1;
}
