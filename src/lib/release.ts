///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import crossSpawn from 'cross-spawn';
import { load as loadYaml } from 'js-yaml';
import semver, { type ReleaseType } from 'semver';

export const RELEASE_TYPES: ReleaseType[] = ['major', 'minor', 'patch', 'premajor', 'preminor', 'prepatch', 'prerelease'];

const UNRELEASED_HEADING = '## Unreleased';
const CHANGELOG_UNRELEASED_HEADING = '## [Unreleased]';
const CHANGELOG_DEFAULT_HEADER = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

${CHANGELOG_UNRELEASED_HEADING}
`;

// Commit message lines matching any of these are dropped from the changelog entirely.
const CHANGELOG_NOISE_PATTERNS: RegExp[] = [
  /^updating (readme\/)?release notes/i,
  /\btests?\b.*\bcoverage\b/i,
  /(claude notes|notes for claude|claude instructions|\.claude\/)/i,
  /^\d+\.\d+\.\d+(-[\w.]+)?$/,
  // Git trailers (attribution/reference metadata, not a user-facing change) - every %B line is a
  // changelog-bullet candidate with no subject/body distinction, so without this a commit's
  // "Co-Authored-By: ..." line (added automatically by Claude Code, among other tools) leaks into
  // the changelog as its own bogus "Changed" bullet.
  /^(co-authored-by|signed-off-by|reviewed-by|acked-by|tested-by|change-id):/i,
];

export type ChangelogCategory = 'Added' | 'Changed' | 'Fixed' | 'Removed';
const CHANGELOG_CATEGORY_ORDER: ChangelogCategory[] = ['Added', 'Changed', 'Fixed', 'Removed'];

// Maps a commit line's leading verb to a changelog category and, where the verb reads awkwardly
// out of commit-message tense (e.g. "Adding", "Switching"), its changelog-tense replacement.
// Verbs not listed here default to the "Changed" category with the line left untouched, which
// also covers noun-led lines like "ObjectFactory now sets...".
const CHANGELOG_VERB_REWRITES: Record<string, { category: ChangelogCategory; word?: string }> = {
  add: { category: 'Added', word: 'Added' },
  added: { category: 'Added' },
  adding: { category: 'Added', word: 'Added' },
  allow: { category: 'Added', word: 'Added' },
  allowing: { category: 'Added', word: 'Added' },
  fix: { category: 'Fixed', word: 'Fixed' },
  fixed: { category: 'Fixed' },
  fixing: { category: 'Fixed', word: 'Fixed' },
  remove: { category: 'Removed', word: 'Removed' },
  removed: { category: 'Removed' },
  removing: { category: 'Removed', word: 'Removed' },
  configuring: { category: 'Changed', word: 'Configured' },
  converting: { category: 'Changed', word: 'Converted' },
  consolidating: { category: 'Changed', word: 'Consolidated' },
  exposing: { category: 'Changed', word: 'Exposed' },
  improving: { category: 'Changed', word: 'Improved' },
  optimizing: { category: 'Changed', word: 'Optimized' },
  refactoring: { category: 'Changed', word: 'Refactored' },
  setting: { category: 'Changed', word: 'Set' },
  swapping: { category: 'Changed', word: 'Swapped' },
  switching: { category: 'Changed', word: 'Switched' },
  updating: { category: 'Changed', word: 'Updated' },
  upgrading: { category: 'Changed', word: 'Upgraded' },
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Runs a command and returns its trimmed stdout, or throws with stderr attached. Uses cross-spawn
// so Windows .cmd shims (e.g. npm) resolve correctly without needing the shell option — passing
// shell:true alongside a separate args array would otherwise trigger Node's DEP0190 warning, since
// the args aren't escaped before being concatenated into the shell command line.
function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = crossSpawn(cmd, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (err) => {
      reject(new Error(`Command failed: ${cmd} ${args.join(' ')}\n${err.message}`));
    });
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Command failed: ${cmd} ${args.join(' ')}\n${stderr || `exited with code ${code}`}`));
    });
  });
}

export async function assertCleanWorkingTree(cwd: string): Promise<void> {
  const status = await run('git', ['status', '--porcelain'], cwd);
  if (status.length > 0) {
    throw new Error('Working tree is not clean. Commit or stash your changes before releasing.');
  }
}

// Computes the target version from either a semver release strategy (applied to the project's
// current version) or an explicit x.y.z version (which must be greater than the current one).
export function computeNewVersion(currentVersion: string, bump: string | undefined, preid: string | undefined): string {
  if (!bump) {
    throw new Error(`A version bump is required: one of ${RELEASE_TYPES.join(', ')}, or an explicit x.y.z version.`);
  }
  if ((RELEASE_TYPES as string[]).includes(bump)) {
    const next = preid
      ? semver.inc(currentVersion, bump as ReleaseType, preid)
      : semver.inc(currentVersion, bump as ReleaseType);
    if (!next) {
      throw new Error(`Could not compute the next version from ${currentVersion} using strategy "${bump}".`);
    }
    return next;
  }
  if (semver.valid(bump)) {
    if (!semver.gt(bump, currentVersion)) {
      throw new Error(`New version ${bump} must be greater than the current version ${currentVersion}.`);
    }
    return bump;
  }
  throw new Error(`"${bump}" is not a valid release strategy or semver version.`);
}

export interface PackageInfo {
  version: string;
  repository?: string | { url?: string };
}

export async function readPackageInfo(cwd: string): Promise<PackageInfo> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, 'package.json'), 'utf-8');
  } catch {
    throw new Error(`No package.json found in ${cwd}.`);
  }
  let pkg: PackageInfo;
  try {
    pkg = JSON.parse(raw) as PackageInfo;
  } catch {
    throw new Error(`package.json in ${cwd} is not valid JSON.`);
  }
  if (!pkg.version) {
    throw new Error(`package.json in ${cwd} has no "version" field.`);
  }
  return pkg;
}

// Strips the "git+" prefix and ".git" suffix npm's repository field commonly carries, so the
// result is directly usable as a browsable URL prefix (e.g. for GitHub compare links).
export function getRepoUrl(pkg: PackageInfo): string | undefined {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return raw ? raw.replace(/^git\+/, '').replace(/\.git$/, '') : undefined;
}

export async function hasUnreleasedSection(cwd: string): Promise<boolean> {
  try {
    const notes = await readFile(join(cwd, 'RELEASE_NOTES.md'), 'utf-8');
    return notes.includes(UNRELEASED_HEADING);
  } catch {
    return false;
  }
}

export async function updateReleaseNotes(cwd: string, version: string): Promise<void> {
  const path = join(cwd, 'RELEASE_NOTES.md');
  const notes = await readFile(path, 'utf-8');
  if (!notes.includes(UNRELEASED_HEADING)) {
    throw new Error(`No "${UNRELEASED_HEADING}" section found in ${path}.`);
  }
  await writeFile(path, notes.replace(UNRELEASED_HEADING, `${UNRELEASED_HEADING}\n\n## v${version}`));
}

export async function previousTag(cwd: string): Promise<string | undefined> {
  try {
    const tag = await run('git', ['describe', '--tags', '--abbrev=0'], cwd);
    return tag || undefined;
  } catch {
    return undefined;
  }
}

// Classifies one line of a commit message into a changelog bullet, or drops it as noise.
export function classifyChangelogLine(line: string): { category: ChangelogCategory; text: string } | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || CHANGELOG_NOISE_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return null;
  }

  const match = trimmed.match(/^(\S+)(\s+.*)?$/s);
  if (!match) {
    return { category: 'Changed', text: trimmed };
  }
  const [, firstWord, rest = ''] = match;
  const rewrite = CHANGELOG_VERB_REWRITES[firstWord.toLowerCase()];
  if (!rewrite) {
    return { category: 'Changed', text: trimmed };
  }
  return { category: rewrite.category, text: rewrite.word ? `${rewrite.word}${rest}` : trimmed };
}

// Collects and classifies every commit-message line (not just subjects) in `range`, oldest first.
export async function collectChangelogBullets(cwd: string, range: string): Promise<{ category: ChangelogCategory; text: string }[]> {
  const raw = await run('git', ['log', range, '--no-merges', '--reverse', '--pretty=format:%B%x1e'], cwd);
  const bullets: { category: ChangelogCategory; text: string }[] = [];
  for (const body of raw.split('\x1e')) {
    for (const line of body.split('\n')) {
      const bullet = classifyChangelogLine(line);
      if (bullet) bullets.push(bullet);
    }
  }
  return bullets;
}

export function buildChangelogEntry(
  version: string,
  date: string,
  bullets: { category: ChangelogCategory; text: string }[],
): string {
  const sections = CHANGELOG_CATEGORY_ORDER.map((category) => {
    const items = bullets.filter((bullet) => bullet.category === category).map((bullet) => `- ${bullet.text}`);
    return items.length > 0 ? `### ${category}\n${items.join('\n')}` : null;
  }).filter((section): section is string => section !== null);

  const body = sections.length > 0 ? sections.join('\n\n') : '_No notable changes._';
  return `## [${version}] - ${date}\n\n${body}\n`;
}

// Splits the file into the changelog body and its trailing block of `[x.y.z]: url` link definitions.
export function splitChangelogLinks(content: string): { body: string; linkLines: string[] } {
  const lines = content.split('\n');
  let i = lines.length - 1;
  while (i >= 0 && lines[i].trim() === '') i--;
  const linkLines: string[] = [];
  while (i >= 0 && /^\[[^\]]+\]:\s/.test(lines[i])) {
    linkLines.unshift(lines[i]);
    i--;
  }
  return { body: lines.slice(0, i + 1).join('\n'), linkLines };
}

export function insertChangelogEntry(body: string, entry: string): string {
  const idx = body.indexOf(CHANGELOG_UNRELEASED_HEADING);
  if (idx === -1) {
    return `${body.trimEnd()}\n\n${CHANGELOG_UNRELEASED_HEADING}\n\n${entry}`;
  }
  const insertAt = idx + CHANGELOG_UNRELEASED_HEADING.length;
  return `${body.slice(0, insertAt)}\n\n${entry}${body.slice(insertAt)}`;
}

export function updateChangelogLinks(
  linkLines: string[],
  version: string,
  prevTag: string | undefined,
  repoUrl: string,
): string[] {
  const filtered = linkLines.filter((line) => !line.startsWith('[Unreleased]:') && !line.startsWith(`[${version}]:`));
  const unreleasedLink = `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`;
  const versionLink = prevTag
    ? `[${version}]: ${repoUrl}/compare/${prevTag}...v${version}`
    : `[${version}]: ${repoUrl}/releases/tag/v${version}`;
  return [unreleasedLink, versionLink, ...filtered];
}

// Summarizes commits since the last tag into a Keep a Changelog-style entry. Degrades gracefully
// (skips the trailing compare-links block, with a warning) when package.json has no "repository"
// field, rather than failing the whole release over changelog cosmetics.
export async function updateChangelog(cwd: string, version: string, warn: (msg: string) => void): Promise<void> {
  const pkg = await readPackageInfo(cwd);
  const repoUrl = getRepoUrl(pkg);
  const prevTag = await previousTag(cwd);
  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD';
  const date = new Date().toISOString().slice(0, 10);

  const bullets = await collectChangelogBullets(cwd, range);
  const entry = buildChangelogEntry(version, date, bullets);

  const changelogPath = join(cwd, 'CHANGELOG.md');
  const existing = (await fileExists(changelogPath)) ? await readFile(changelogPath, 'utf-8') : CHANGELOG_DEFAULT_HEADER;
  const { body, linkLines } = splitChangelogLinks(existing);
  const newBody = insertChangelogEntry(body, entry);

  let content: string;
  if (repoUrl) {
    const newLinkLines = updateChangelogLinks(linkLines, version, prevTag, repoUrl);
    content = `${newBody.trimEnd()}\n\n${newLinkLines.join('\n')}\n`;
  } else {
    warn('No "repository" field found in package.json — skipping CHANGELOG.md compare links.');
    content = `${newBody.trimEnd()}\n`;
  }
  await writeFile(changelogPath, content.replace(/\n{3,}/g, '\n\n'));
}

// A project only carries a Helm chart (and the deployable-service artifacts release-notes-adjacent
// to it) when both files below exist — used to skip the whole Helm/README/install-script update
// step for internal libraries (core, service-core, etc.) that don't ship one.
export async function detectHelm(cwd: string): Promise<boolean> {
  const [hasValues, hasChart] = await Promise.all([
    fileExists(join(cwd, 'helm', 'values.yaml')),
    fileExists(join(cwd, 'helm', 'Chart.yaml')),
  ]);
  return hasValues && hasChart;
}

interface HelmValues {
  service?: { image?: { tag?: string } };
}

// Confirms both Helm files parse and have the field this command needs to set, before any
// mutation happens — called during pre-flight so a malformed chart fails before `npm version`
// has already bumped package.json.
export async function validateHelmFiles(cwd: string): Promise<void> {
  const valuesPath = join(cwd, 'helm', 'values.yaml');
  const values = loadYaml(await readFile(valuesPath, 'utf-8')) as HelmValues;
  if (!values.service?.image) {
    throw new Error(`${valuesPath} does not have the expected "service.image.tag" field.`);
  }
  const chartPath = join(cwd, 'helm', 'Chart.yaml');
  loadYaml(await readFile(chartPath, 'utf-8'));
}

const YAML_KEY_LINE = /^(\s*)(?:(-)\s+)?([A-Za-z0-9_.-]+|"[^"]*"|'[^']*'):(?=\s|$)(.*)$/;

function unquoteYamlKey(key: string): string {
  return /^["']/.test(key) ? key.slice(1, -1) : key;
}

// Splits what follows `key:` into its scalar (with quotes, if any) and the rest of the line (a trailing comment).
// Returns undefined for values this can't rewrite in place: block scalars, flow collections, anchors, aliases and tags.
function splitYamlScalar(rest: string): { leading: string; scalar: string; trailing: string } | undefined {
  const leading = /^\s*/.exec(rest)![0];
  const body = rest.slice(leading.length);
  if (/^[|>{[&*!]/.test(body)) {
    return undefined;
  }
  let end: number;
  if (body.startsWith('"')) {
    end = 1;
    while (end < body.length && body[end] !== '"') {
      end += body[end] === '\\' ? 2 : 1;
    }
    end += 1;
  } else if (body.startsWith("'")) {
    end = 1;
    while (end < body.length && !(body[end] === "'" && body[end + 1] !== "'")) {
      end += body[end] === "'" ? 2 : 1;
    }
    end += 1;
  } else {
    const comment = /(^|\s)#/.exec(body);
    end = comment ? comment.index : body.length;
    while (end > 0 && /\s/.test(body[end - 1])) {
      end -= 1;
    }
  }
  return { leading, scalar: body.slice(0, end), trailing: body.slice(end) };
}

function yamlValueAt(content: string, path: string[]): unknown {
  let node: unknown = loadYaml(content);
  for (const key of path) {
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined;
  }
  return node;
}

// Sets the mapping value at `path` (e.g. ["service", "image", "tag"]) to the string `value` by rewriting only that line,
// so comments, key order, quoting style and formatting everywhere else stay exactly as they were - loading and dumping
// the document would drop every comment. The key is added under its parent when missing (the parent must exist). The
// result is parsed again to confirm the value landed where expected; anything this can't edit in place throws.
export function setYamlScalar(content: string, path: string[], value: string): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const stack: { indent: number; key: string }[] = [];
  const parentPath = path.slice(0, -1).join('\0');
  let parentLine = parentPath === '' ? -1 : undefined;
  let blockScalarIndent: number | undefined;
  let done = false;

  for (let i = 0; i < lines.length && !done; i++) {
    const line = lines[i];
    const indent = /^\s*/.exec(line)![0].length;
    if (blockScalarIndent !== undefined) {
      if (line.trim() === '' || indent > blockScalarIndent) {
        continue;
      }
      blockScalarIndent = undefined;
    }
    if (/^\s*(#.*)?$/.test(line) || /^\s*(---|\.\.\.)\s*$/.test(line)) {
      continue;
    }
    const match = YAML_KEY_LINE.exec(line);
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    if (/^\s*-(\s|$)/.test(line)) {
      // A sequence item: nothing beneath it is on a mapping-only path.
      stack.push({ indent, key: '\0-' });
    }
    if (!match) {
      continue;
    }
    const keyIndent = match[2] ? line.indexOf(match[3], indent + 1) : indent;
    stack.push({ indent: keyIndent, key: unquoteYamlKey(match[3]) });
    const keys = stack.map((entry) => entry.key);
    const rest = match[4];
    if (/^\s*[|>]/.test(rest)) {
      blockScalarIndent = keyIndent;
    }
    if (keys.join('\0') === path.join('\0')) {
      const parts = splitYamlScalar(rest);
      if (!parts) {
        throw new Error(`Can't update "${path.join('.')}": its value isn't a plain or quoted scalar.`);
      }
      const quote = /^["']/.test(parts.scalar) ? parts.scalar[0] : '';
      const leading = parts.scalar === '' ? ' ' : parts.leading;
      // An empty value followed by a comment ("tag: # set by CI") keeps a space before the comment.
      const trailing = parts.scalar === '' && parts.trailing !== '' ? ` ${parts.trailing.trimStart()}` : parts.trailing;
      lines[i] = `${line.slice(0, line.length - rest.length)}${leading}${quote}${value}${quote}${trailing}`;
      done = true;
    } else if (keys.join('\0') === parentPath) {
      parentLine = i;
    }
  }

  if (!done) {
    if (parentLine === undefined) {
      throw new Error(`Can't update "${path.join('.')}": "${path.slice(0, -1).join('.')}" doesn't exist.`);
    }
    const leaf = path[path.length - 1];
    if (parentLine === -1) {
      const last = lines.length > 0 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
      lines.splice(last, 0, `${leaf}: ${value}`);
    } else {
      const parentIndent = /^\s*/.exec(lines[parentLine])![0].length;
      const next = lines.slice(parentLine + 1).find((l) => !/^\s*(#.*)?$/.test(l));
      const nextIndent = next === undefined ? 0 : /^\s*/.exec(next)![0].length;
      const childIndent = nextIndent > parentIndent ? nextIndent : parentIndent + 2;
      lines.splice(parentLine + 1, 0, `${' '.repeat(childIndent)}${leaf}: ${value}`);
    }
  }

  const result = lines.join(eol);
  let updated: unknown;
  try {
    updated = yamlValueAt(result, path);
  } catch {
    updated = undefined;
  }
  if (String(updated) !== value) {
    throw new Error(`Updating "${path.join('.')}" didn't produce the expected value; update it by hand.`);
  }
  return result;
}

// Updates the project's own version in its README (the server template's layout), located by structure rather than by
// matching version text: sibling projects are released in lock-step, so the README can mention another chart or package
// at the very same version, which must stay put. Only two spots change:
// - the "Tag" row of the Docker Image table (the one with a "Repository" row), keeping the column width;
// - `--version` after this project's own chart reference, `.../charts/<chartName>` (from Chart.yaml's name).
export function updateReadmeVersion(readme: string, chartName: string, version: string): string {
  const semverText = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`;
  const eol = readme.includes('\r\n') ? '\r\n' : '\n';
  const lines = readme.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const tagRow = new RegExp(String.raw`^(\|\s*Tag\s*\|)( *)(${semverText})( *)(\|.*)$`).exec(lines[i]);
    if (!tagRow) {
      continue;
    }
    // Only inside a table that also has a Repository row (the Docker Image table).
    let start = i;
    while (start > 0 && lines[start - 1].trimStart().startsWith('|')) start -= 1;
    let end = i;
    while (end < lines.length - 1 && lines[end + 1].trimStart().startsWith('|')) end += 1;
    if (!lines.slice(start, end + 1).some((line) => /^\|\s*Repository\s*\|/.test(line))) {
      continue;
    }
    const [, label, before, current, after, rest] = tagRow;
    const width = before.length + current.length + after.length;
    const padding = ' '.repeat(Math.max(1, width - before.length - version.length));
    lines[i] = `${label}${before}${version}${padding}${rest}`;
  }
  const escapedName = chartName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const chartReference = new RegExp(String.raw`(/charts/${escapedName}\s+--version[=\s]+)${semverText}(?![0-9A-Za-z.+-])`, 'g');
  return lines.join(eol).replace(chartReference, (_match, prefix: string) => `${prefix}${version}`);
}

// Updates the Helm chart's image tag/appVersion, plus any single_node_install.sh / README.md
// version references — but only the latter two if the project actually has them, since neither
// is guaranteed to exist even on a project that does ship a Helm chart. Every change is located by
// structure, never by matching the previous version's text, because sibling projects share
// versions: the YAML files change only `service.image.tag` and `appVersion` (keeping comments and
// formatting), the install script only its own `VERSION=` line, and the README only its Docker
// Image table's Tag row and this chart's own `--version` (see updateReadmeVersion). Returns the
// paths (relative to cwd) it actually touched, for staging alongside the version bump commit.
export async function updateHelmVersion(cwd: string, version: string): Promise<string[]> {
  const touched: string[] = [];

  const valuesPath = join(cwd, 'helm', 'values.yaml');
  await writeFile(valuesPath, setYamlScalar(await readFile(valuesPath, 'utf-8'), ['service', 'image', 'tag'], version));
  touched.push(join('helm', 'values.yaml'));

  const chartPath = join(cwd, 'helm', 'Chart.yaml');
  const chartContent = await readFile(chartPath, 'utf-8');
  const chartName = String((loadYaml(chartContent) as { name?: unknown } | null)?.name ?? '');
  await writeFile(chartPath, setYamlScalar(chartContent, ['appVersion'], version));
  touched.push(join('helm', 'Chart.yaml'));

  const installScriptPath = join(cwd, 'single_node_install.sh');
  if (await fileExists(installScriptPath)) {
    // Only a line that assigns VERSION itself (not e.g. OTHER_VERSION=), keeping its quoting.
    const installScriptRegex =
      /^(\s*(?:export\s+)?VERSION=)(["']?)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\2(?=\s|;|$)/gm;
    const installScript = await readFile(installScriptPath, 'utf-8');
    await writeFile(
      installScriptPath,
      installScript.replace(installScriptRegex, (_match, assignment: string, quote: string) => `${assignment}${quote}${version}${quote}`),
    );
    touched.push('single_node_install.sh');
  }

  const readmePath = join(cwd, 'README.md');
  if (await fileExists(readmePath)) {
    const readme = await readFile(readmePath, 'utf-8');
    await writeFile(readmePath, updateReadmeVersion(readme, chartName, version));
    touched.push('README.md');
  }

  return touched;
}

// --no-git-tag-version: this command does its own combined commit/tag afterward (stageAndCommit).
// --ignore-scripts: skips the project's own pre/postversion hooks so this command fully owns the
// release flow regardless of what hooks a project's package.json happens to define.
export async function bumpPackageVersion(cwd: string, version: string): Promise<void> {
  await run('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts'], cwd);
}

export async function stageAndCommit(cwd: string, version: string, extraFiles: string[]): Promise<void> {
  const lockFiles = (
    await Promise.all(
      ['package-lock.json', 'yarn.lock'].map(async (f) => ((await fileExists(join(cwd, f))) ? f : undefined)),
    )
  ).filter((f): f is string => f !== undefined);

  await run('git', ['add', 'package.json', ...lockFiles, 'RELEASE_NOTES.md', 'CHANGELOG.md', ...extraFiles], cwd);
  await run('git', ['commit', '-m', version], cwd);
  await run('git', ['tag', `v${version}`], cwd);
}

export async function pushRelease(cwd: string): Promise<void> {
  await run('git', ['push'], cwd);
  await run('git', ['push', '--tags'], cwd);
}
