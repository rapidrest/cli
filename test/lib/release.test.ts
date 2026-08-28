///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { promisify } from 'util';
import {
  assertCleanWorkingTree,
  bumpPackageVersion,
  buildChangelogEntry,
  classifyChangelogLine,
  collectChangelogBullets,
  computeNewVersion,
  detectHelm,
  getRepoUrl,
  hasUnreleasedSection,
  insertChangelogEntry,
  previousTag,
  readPackageInfo,
  splitChangelogLinks,
  stageAndCommit,
  updateChangelog,
  updateChangelogLinks,
  updateHelmVersion,
  updateReleaseNotes,
  validateHelmFiles,
} from '../../src/lib/release.js';

const execFileAsync = promisify(execFile);

async function initGitRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init', '-q'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
}

async function commitAll(dir: string, message: string): Promise<void> {
  await execFileAsync('git', ['add', '-A'], { cwd: dir });
  await execFileAsync('git', ['commit', '-q', '-m', message], { cwd: dir });
}

describe('computeNewVersion', () => {
  it('applies a release strategy to the current version', () => {
    expect(computeNewVersion('1.2.3', 'patch', undefined)).toBe('1.2.4');
    expect(computeNewVersion('1.2.3', 'minor', undefined)).toBe('1.3.0');
    expect(computeNewVersion('1.2.3', 'major', undefined)).toBe('2.0.0');
  });

  it('applies a preid to prerelease strategies', () => {
    expect(computeNewVersion('1.2.3', 'prerelease', 'rc')).toBe('1.2.4-rc.0');
    expect(computeNewVersion('1.2.3', 'premajor', 'beta')).toBe('2.0.0-beta.0');
  });

  it('accepts an explicit version greater than the current one', () => {
    expect(computeNewVersion('1.2.3', '2.0.0', undefined)).toBe('2.0.0');
  });

  it('throws when no bump is given', () => {
    expect(() => computeNewVersion('1.2.3', undefined, undefined)).toThrow(/version bump is required/);
  });

  it('throws when the explicit version is not greater than the current one', () => {
    expect(() => computeNewVersion('1.2.3', '1.0.0', undefined)).toThrow(/must be greater than/);
    expect(() => computeNewVersion('1.2.3', '1.2.3', undefined)).toThrow(/must be greater than/);
  });

  it('throws for an unrecognized strategy/version', () => {
    expect(() => computeNewVersion('1.2.3', 'sideways', undefined)).toThrow(/not a valid release strategy/);
  });
});

describe('classifyChangelogLine', () => {
  it('categorizes and rewrites "-ing" verbs into their changelog tense', () => {
    expect(classifyChangelogLine('Adding a new feature')).toEqual({ category: 'Added', text: 'Added a new feature' });
    expect(classifyChangelogLine('Fixing a bug in the widget')).toEqual({ category: 'Fixed', text: 'Fixed a bug in the widget' });
    expect(classifyChangelogLine('Removing dead code')).toEqual({ category: 'Removed', text: 'Removed dead code' });
    expect(classifyChangelogLine('Updating dependencies')).toEqual({ category: 'Changed', text: 'Updated dependencies' });
  });

  it('leaves already-past-tense verbs as-is', () => {
    expect(classifyChangelogLine('Fixed a bug')).toEqual({ category: 'Fixed', text: 'Fixed a bug' });
    expect(classifyChangelogLine('Added support for X')).toEqual({ category: 'Added', text: 'Added support for X' });
  });

  it('defaults unrecognized leading words to Changed, unmodified', () => {
    expect(classifyChangelogLine('ObjectFactory now sets defaults')).toEqual({
      category: 'Changed',
      text: 'ObjectFactory now sets defaults',
    });
  });

  it('drops noise lines entirely', () => {
    expect(classifyChangelogLine('Updating release notes')).toBeNull();
    expect(classifyChangelogLine('Improve test coverage')).toBeNull();
    expect(classifyChangelogLine('Updating claude notes')).toBeNull();
    expect(classifyChangelogLine('1.2.3')).toBeNull();
    expect(classifyChangelogLine('   ')).toBeNull();
  });
});

describe('buildChangelogEntry', () => {
  it('groups bullets under their category headings in a fixed order', () => {
    const entry = buildChangelogEntry('1.2.4', '2026-08-28', [
      { category: 'Fixed', text: 'Fixed a bug' },
      { category: 'Added', text: 'Added a feature' },
      { category: 'Changed', text: 'Changed some config' },
    ]);
    expect(entry).toBe(
      '## [1.2.4] - 2026-08-28\n\n'
      + '### Added\n- Added a feature\n\n'
      + '### Changed\n- Changed some config\n\n'
      + '### Fixed\n- Fixed a bug\n',
    );
  });

  it('falls back to "_No notable changes._" when there are no bullets', () => {
    const entry = buildChangelogEntry('1.2.4', '2026-08-28', []);
    expect(entry).toBe('## [1.2.4] - 2026-08-28\n\n_No notable changes._\n');
  });
});

describe('splitChangelogLinks / insertChangelogEntry / updateChangelogLinks', () => {
  it('splits trailing [x.y.z]: url link lines from the body', () => {
    const content = '# Changelog\n\n## [Unreleased]\n\n[Unreleased]: https://x/compare/v1.0.0...HEAD\n[1.0.0]: https://x/releases/tag/v1.0.0\n';
    const { body, linkLines } = splitChangelogLinks(content);
    expect(body).toBe('# Changelog\n\n## [Unreleased]\n');
    expect(linkLines).toEqual([
      '[Unreleased]: https://x/compare/v1.0.0...HEAD',
      '[1.0.0]: https://x/releases/tag/v1.0.0',
    ]);
  });

  it('returns no link lines when there are none', () => {
    const { body, linkLines } = splitChangelogLinks('# Changelog\n\n## [Unreleased]\n');
    expect(body).toBe('# Changelog\n\n## [Unreleased]');
    expect(linkLines).toEqual([]);
  });

  it('inserts the new entry directly under the [Unreleased] heading', () => {
    const body = '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n_No notable changes._';
    const result = insertChangelogEntry(body, '## [1.1.0] - 2026-08-28\n\n### Added\n- Added X\n');
    expect(result).toBe(
      '# Changelog\n\n## [Unreleased]\n\n## [1.1.0] - 2026-08-28\n\n### Added\n- Added X\n\n\n## [1.0.0] - 2026-01-01\n\n_No notable changes._',
    );
  });

  it('appends an [Unreleased] heading when the body has none', () => {
    const result = insertChangelogEntry('# Changelog', '## [1.0.0] - 2026-01-01\n\n_No notable changes._\n');
    expect(result).toBe('# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n_No notable changes._\n');
  });

  it('replaces any existing links for [Unreleased] and the new version, keeping older ones', () => {
    const result = updateChangelogLinks(
      ['[Unreleased]: https://x/compare/v1.0.0...HEAD', '[1.0.0]: https://x/releases/tag/v1.0.0'],
      '1.1.0',
      'v1.0.0',
      'https://x',
    );
    expect(result).toEqual([
      '[Unreleased]: https://x/compare/v1.1.0...HEAD',
      '[1.1.0]: https://x/compare/v1.0.0...v1.1.0',
      '[1.0.0]: https://x/releases/tag/v1.0.0',
    ]);
  });

  it('links the first release straight to its tag when there is no previous tag', () => {
    const result = updateChangelogLinks([], '1.0.0', undefined, 'https://x');
    expect(result).toEqual([
      '[Unreleased]: https://x/compare/v1.0.0...HEAD',
      '[1.0.0]: https://x/releases/tag/v1.0.0',
    ]);
  });
});

describe('getRepoUrl', () => {
  it('strips a git+ prefix and .git suffix from a string repository field', () => {
    expect(getRepoUrl({ version: '1.0.0', repository: 'git+https://github.com/rapidrest/core.git' }))
      .toBe('https://github.com/rapidrest/core');
  });

  it('reads the url from an object repository field', () => {
    expect(getRepoUrl({ version: '1.0.0', repository: { url: 'https://github.com/rapidrest/core.git' } }))
      .toBe('https://github.com/rapidrest/core');
  });

  it('returns undefined when there is no repository field', () => {
    expect(getRepoUrl({ version: '1.0.0' })).toBeUndefined();
  });
});

describe('readPackageInfo', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrrelease-pkg-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads version and repository from package.json', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ version: '1.0.0', repository: 'https://x' }));
    expect(await readPackageInfo(tmpDir)).toEqual({ version: '1.0.0', repository: 'https://x' });
  });

  it('throws when package.json does not exist', async () => {
    await expect(readPackageInfo(tmpDir)).rejects.toThrow(/No package\.json found/);
  });

  it('throws when package.json is invalid JSON', async () => {
    await writeFile(join(tmpDir, 'package.json'), 'not json');
    await expect(readPackageInfo(tmpDir)).rejects.toThrow(/not valid JSON/);
  });

  it('throws when package.json has no version field', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'x' }));
    await expect(readPackageInfo(tmpDir)).rejects.toThrow(/no "version" field/);
  });
});

describe('hasUnreleasedSection / updateReleaseNotes', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrrelease-notes-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('detects the "## Unreleased" heading', async () => {
    await writeFile(join(tmpDir, 'RELEASE_NOTES.md'), '# Release Notes\n\n## Unreleased\n\n- X\n');
    expect(await hasUnreleasedSection(tmpDir)).toBe(true);
  });

  it('returns false when the file exists but has no Unreleased heading', async () => {
    await writeFile(join(tmpDir, 'RELEASE_NOTES.md'), '# Release Notes\n\n## v1.0.0\n');
    expect(await hasUnreleasedSection(tmpDir)).toBe(false);
  });

  it('returns false when RELEASE_NOTES.md does not exist', async () => {
    expect(await hasUnreleasedSection(tmpDir)).toBe(false);
  });

  it('promotes the Unreleased heading to the new version', async () => {
    await writeFile(join(tmpDir, 'RELEASE_NOTES.md'), '# Release Notes\n\n## Unreleased\n\n- X\n');
    await updateReleaseNotes(tmpDir, '1.2.4');
    const content = await readFile(join(tmpDir, 'RELEASE_NOTES.md'), 'utf-8');
    expect(content).toBe('# Release Notes\n\n## v1.2.4\n\n- X\n');
  });

  it('throws when there is no Unreleased heading to promote', async () => {
    await writeFile(join(tmpDir, 'RELEASE_NOTES.md'), '# Release Notes\n\n## v1.0.0\n');
    await expect(updateReleaseNotes(tmpDir, '1.2.4')).rejects.toThrow(/No "## Unreleased" section/);
  });
});

describe('detectHelm / validateHelmFiles / updateHelmVersion', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrrelease-helm-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeHelmFiles(): Promise<void> {
    await mkdir(join(tmpDir, 'helm'), { recursive: true });
    await writeFile(
      join(tmpDir, 'helm', 'values.yaml'),
      'service:\n  image:\n    tag: "1.0.0"\n    repository: ghcr.io/x\n',
    );
    await writeFile(join(tmpDir, 'helm', 'Chart.yaml'), 'apiVersion: v2\nname: x\nappVersion: "1.0.0"\nversion: 0.1.0\n');
  }

  it('detects Helm only when both values.yaml and Chart.yaml exist', async () => {
    expect(await detectHelm(tmpDir)).toBe(false);
    await mkdir(join(tmpDir, 'helm'), { recursive: true });
    await writeFile(join(tmpDir, 'helm', 'values.yaml'), 'service: {}\n');
    expect(await detectHelm(tmpDir)).toBe(false);
    await writeHelmFiles();
    expect(await detectHelm(tmpDir)).toBe(true);
  });

  it('validateHelmFiles throws when values.yaml has no service.image field', async () => {
    await mkdir(join(tmpDir, 'helm'), { recursive: true });
    await writeFile(join(tmpDir, 'helm', 'values.yaml'), 'service: {}\n');
    await writeFile(join(tmpDir, 'helm', 'Chart.yaml'), 'appVersion: "1.0.0"\n');
    await expect(validateHelmFiles(tmpDir)).rejects.toThrow(/service\.image\.tag/);
  });

  it('validateHelmFiles resolves when both files have the expected shape', async () => {
    await writeHelmFiles();
    await expect(validateHelmFiles(tmpDir)).resolves.toBeUndefined();
  });

  it('updates values.yaml tag and Chart.yaml appVersion', async () => {
    await writeHelmFiles();
    const touched = await updateHelmVersion(tmpDir, '1.2.4');
    expect(touched).toEqual([join('helm', 'values.yaml'), join('helm', 'Chart.yaml')]);

    const values = await readFile(join(tmpDir, 'helm', 'values.yaml'), 'utf-8');
    expect(values).toContain('tag: 1.2.4');
    const chart = await readFile(join(tmpDir, 'helm', 'Chart.yaml'), 'utf-8');
    expect(chart).toContain('appVersion: 1.2.4');
  });

  it('also updates single_node_install.sh and README.md when present, and reports them as touched', async () => {
    await writeHelmFiles();
    await writeFile(join(tmpDir, 'single_node_install.sh'), '#!/bin/sh\nVERSION="1.0.0"\necho "$VERSION"\n');
    await writeFile(join(tmpDir, 'README.md'), '# X\n\nInstall version 1.0.0 via helm --version 1.0.0\n');

    const touched = await updateHelmVersion(tmpDir, '1.2.4');
    expect(touched).toEqual(
      expect.arrayContaining([join('helm', 'values.yaml'), join('helm', 'Chart.yaml'), 'single_node_install.sh', 'README.md']),
    );

    const script = await readFile(join(tmpDir, 'single_node_install.sh'), 'utf-8');
    expect(script).toContain('VERSION="1.2.4"');
    const readme = await readFile(join(tmpDir, 'README.md'), 'utf-8');
    expect(readme).toBe('# X\n\nInstall version 1.2.4 via helm --version 1.2.4\n');
  });

  it('skips single_node_install.sh and README.md when neither exists', async () => {
    await writeHelmFiles();
    const touched = await updateHelmVersion(tmpDir, '1.2.4');
    expect(touched).not.toContain('single_node_install.sh');
    expect(touched).not.toContain('README.md');
  });
});

describe('git-backed release flow', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrrelease-git-'));
    await initGitRepo(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('assertCleanWorkingTree resolves on a clean tree and throws on a dirty one', async () => {
    await writeFile(join(tmpDir, 'README.md'), 'x\n');
    await commitAll(tmpDir, 'init');
    await expect(assertCleanWorkingTree(tmpDir)).resolves.toBeUndefined();

    await writeFile(join(tmpDir, 'README.md'), 'y\n');
    await expect(assertCleanWorkingTree(tmpDir)).rejects.toThrow(/not clean/);
  });

  it('previousTag returns undefined when there are no tags, and the latest tag once one exists', async () => {
    await writeFile(join(tmpDir, 'README.md'), 'x\n');
    await commitAll(tmpDir, 'init');
    expect(await previousTag(tmpDir)).toBeUndefined();

    await execFileAsync('git', ['tag', 'v1.0.0'], { cwd: tmpDir });
    expect(await previousTag(tmpDir)).toBe('v1.0.0');
  });

  it('collectChangelogBullets classifies every commit line in the range', async () => {
    await writeFile(join(tmpDir, 'a.txt'), 'a\n');
    await commitAll(tmpDir, 'Adding a feature');
    await writeFile(join(tmpDir, 'b.txt'), 'b\n');
    await commitAll(tmpDir, 'Fixing a bug');

    const bullets = await collectChangelogBullets(tmpDir, 'HEAD');
    expect(bullets).toEqual([
      { category: 'Added', text: 'Added a feature' },
      { category: 'Fixed', text: 'Fixed a bug' },
    ]);
  });

  it('updateChangelog writes a new entry and compare links from the commit history', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ version: '1.0.0', repository: 'https://github.com/x/y.git' }));
    await commitAll(tmpDir, 'Adding a feature');

    const warnings: string[] = [];
    await updateChangelog(tmpDir, '1.1.0', (m) => warnings.push(m));

    const changelog = await readFile(join(tmpDir, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('## [1.1.0]');
    expect(changelog).toContain('### Added\n- Added a feature');
    expect(changelog).toContain('[Unreleased]: https://github.com/x/y/compare/v1.1.0...HEAD');
    expect(changelog).toContain('[1.1.0]: https://github.com/x/y/releases/tag/v1.1.0');
    expect(warnings).toEqual([]);
  });

  it('updateChangelog warns and omits compare links when package.json has no repository field', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    await commitAll(tmpDir, 'Adding a feature');

    const warnings: string[] = [];
    await updateChangelog(tmpDir, '1.1.0', (m) => warnings.push(m));

    const changelog = await readFile(join(tmpDir, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('## [1.1.0]');
    expect(changelog).not.toContain('[Unreleased]:');
    expect(warnings.some((w) => w.includes('No "repository" field'))).toBe(true);
  });

  it('bumpPackageVersion updates package.json without creating a git tag', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    await commitAll(tmpDir, 'init');

    await bumpPackageVersion(tmpDir, '1.1.0');

    const pkg = JSON.parse(await readFile(join(tmpDir, 'package.json'), 'utf-8')) as { version: string };
    expect(pkg.version).toBe('1.1.0');
    const tags = await execFileAsync('git', ['tag'], { cwd: tmpDir });
    expect(tags.stdout.trim()).toBe('');
  });

  it('stageAndCommit commits package.json/RELEASE_NOTES.md/CHANGELOG.md/extra files and tags v<version>', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    await writeFile(join(tmpDir, 'RELEASE_NOTES.md'), '# Release Notes\n');
    await commitAll(tmpDir, 'init');

    // Simulate the mutation phase's file writes without going through git add yet.
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'x', version: '1.1.0' }));
    await writeFile(join(tmpDir, 'CHANGELOG.md'), '# Changelog\n');
    await mkdir(join(tmpDir, 'helm'), { recursive: true });
    await writeFile(join(tmpDir, 'helm', 'values.yaml'), 'service: {}\n');

    await stageAndCommit(tmpDir, '1.1.0', [join('helm', 'values.yaml')]);

    const log = await execFileAsync('git', ['log', '--oneline', '-1'], { cwd: tmpDir });
    expect(log.stdout.trim().endsWith('1.1.0')).toBe(true);
    const tags = await execFileAsync('git', ['tag'], { cwd: tmpDir });
    expect(tags.stdout.trim()).toBe('v1.1.0');
    const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: tmpDir });
    expect(status.stdout.trim()).toBe('');
  });
});
