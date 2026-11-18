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
//   without extension stays without, a folder import stays a folder import;
// - in Markdown, relative links to a moved file or folder;
// - anywhere, the path written from the repository root (`src/a/b.ts`, `src/a/b`, `/src/a/b.ts`,
//   globs under a moved folder) and its `@/` form.
// Refused, naming each one: an old path left in a form it cannot rewrite (a glob such as
// `src/a/b*.ts`). Nothing changes while one is left.
// To review, listed by `--check` and required to be acknowledged with `--reviewed`:
// - a folder outside Markdown that held a moved file and no longer holds it (coverage zones,
//   chunk selection, ESLint globs): the move changes what that rule applies to;
// - the moved file's name in a path the tool could not resolve (`utils/b.ts`, `\/b\.ts`).
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

const fail = message => {
  console.error(`move-modules: ${message}`);
  process.exit(1);
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
  let relative = posix.relative(posix.dirname(newImporter), written === '.' ? '' : written) || '.';
  if (!relative.startsWith('.')) relative = `./${relative}`;
  return relative + query;
};

const rewriteMarkdownLink = (target, file, newFile, context) => {
  if (/^[a-z][a-z0-9+.-]*:|^[#/]/i.test(target)) return null;
  const [linkPath, suffix = ''] = target.split(/(?=[#?])|(?=:\d)/, 2);
  const absolute = posix.normalize(posix.join(posix.dirname(file), linkPath));
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

/** Folders that held a moved file and will not hold it: rules scoped to them change reach. */
const buildLostFolderPattern = (moved, folders) => {
  const lost = new Map();
  for (const [from, to] of moved) {
    for (let folder = posix.dirname(from); folder !== '.'; folder = posix.dirname(folder)) {
      if (to.startsWith(`${folder}/`)) break;
      if (folders.some(moving => folder === moving.from || folder.startsWith(`${moving.from}/`)))
        continue;
      for (const form of [folder, aliasOf(folder)].filter(Boolean)) {
        if (!lost.has(form)) lost.set(form, new Set());
        lost.get(form).add(from);
      }
    }
  }
  if (lost.size === 0) return null;
  const alternatives = [...lost.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  const tail = '(?:/\\*{1,2}(?:/[\\w.{},*\\-]*)?|/)?(?![\\w\\-/*]|\\.\\w)';
  return { lost, pattern: new RegExp(`${PATH_START}(${alternatives.join('|')})${tail}`, 'g') };
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
  const lostFolders = buildLostFolderPattern(moved, folders);
  const namePattern = buildNamePattern(moved, files);
  const result = { moved, changes: [], writes: [], leftovers: [], review: [] };

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
      }
    }
    for (const match of text.matchAll(rewrite.pattern)) {
      addEdit(match.index, match.index + match[0].length, rewrite.forms.get(match[0]).newPath);
    }
    if (lostFolders && !MARKDOWN_FILE.test(file)) {
      for (const match of text.matchAll(lostFolders.pattern)) {
        const examples = [...lostFolders.lost.get(match[1])].slice(0, 2).join(', ');
        result.review.push({
          file,
          line: lineOf(text, match.index),
          reason: `folder ${match[0]} will no longer hold ${examples}`,
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
    if (edits.length > 0) result.writes.push({ path: newFile, content: next });
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

const main = () => {
  const options = parseArguments(process.argv.slice(2));
  const { moved, changes, writes, leftovers, review } = planMove(options);
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
  if (leftovers.length > 0) {
    console.error(
      '\nmove-modules: these references name a moved path in a form it cannot rewrite:'
    );
    for (const item of leftovers)
      console.error(`  ${item.file}:${item.line}  ${item.path}  (${item.text})`);
    fail(
      'write each one as a plain path or a glob of its folder, then run again. Nothing was changed.'
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
  for (const write of writes) fs.writeFileSync(write.path, write.content);
};

main();
