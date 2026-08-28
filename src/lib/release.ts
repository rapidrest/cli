///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { execFile } from 'child_process';
import { access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import semver, { type ReleaseType } from 'semver';

const execFileAsync = promisify(execFile);

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

// Runs a command and returns its trimmed stdout, or throws with stderr attached. `shell` is only
// needed on Windows to resolve .cmd shims (e.g. npm) — git resolves as a real executable everywhere.
async function run(cmd: string, args: string[], cwd: string, opts: { shell?: boolean } = {}): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { cwd, shell: opts.shell });
    return stdout.trim();
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}\n${err.stderr ?? err.message}`);
  }
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
  await writeFile(path, notes.replace(UNRELEASED_HEADING, `## v${version}`));
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
interface HelmChart {
  appVersion?: string;
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

// Updates the Helm chart's image tag/appVersion, plus any single_node_install.sh / README.md
// version references — but only the latter two if the project actually has them, since neither
// is guaranteed to exist even on a project that does ship a Helm chart. Returns the paths
// (relative to cwd) it actually touched, for staging alongside the version bump commit.
export async function updateHelmVersion(cwd: string, version: string): Promise<string[]> {
  const touched: string[] = [];

  const valuesPath = join(cwd, 'helm', 'values.yaml');
  const values = loadYaml(await readFile(valuesPath, 'utf-8')) as HelmValues;
  values.service!.image!.tag = version;
  await writeFile(valuesPath, dumpYaml(values));
  touched.push(join('helm', 'values.yaml'));

  const chartPath = join(cwd, 'helm', 'Chart.yaml');
  const chart = loadYaml(await readFile(chartPath, 'utf-8')) as HelmChart;
  chart.appVersion = version;
  await writeFile(chartPath, dumpYaml(chart));
  touched.push(join('helm', 'Chart.yaml'));

  const installScriptPath = join(cwd, 'single_node_install.sh');
  if (await fileExists(installScriptPath)) {
    const installScriptRegex = /VERSION="?\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b"?/g;
    const installScript = await readFile(installScriptPath, 'utf-8');
    await writeFile(installScriptPath, installScript.replace(installScriptRegex, `VERSION="${version}"`));
    touched.push('single_node_install.sh');
  }

  const readmePath = join(cwd, 'README.md');
  if (await fileExists(readmePath)) {
    const readmeRegex = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b/g;
    const readme = await readFile(readmePath, 'utf-8');
    await writeFile(readmePath, readme.replace(readmeRegex, version));
    touched.push('README.md');
  }

  return touched;
}

// --no-git-tag-version: this command does its own combined commit/tag afterward (stageAndCommit).
// --ignore-scripts: skips the project's own pre/postversion hooks so this command fully owns the
// release flow regardless of what hooks a project's package.json happens to define.
export async function bumpPackageVersion(cwd: string, version: string): Promise<void> {
  if (process.platform === 'win32') {
    // execFile's shell:true concatenates an args array unescaped (Node's DEP0190 warning), so
    // build one command string instead.
    await run(`npm version ${version} --no-git-tag-version --ignore-scripts`, [], cwd, { shell: true });
  } else {
    await run('npm', ['version', version, '--no-git-tag-version', '--ignore-scripts'], cwd);
  }
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
