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
  setYamlScalar,
  splitChangelogLinks,
  stageAndCommit,
  updateChangelog,
  updateChangelogLinks,
  updateHelmVersion,
  updateReadmeVersion,
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

  it('drops git trailer lines (attribution/reference metadata, not a changelog-worthy change)', () => {
    expect(classifyChangelogLine('Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>')).toBeNull();
    expect(classifyChangelogLine('Signed-off-by: Jean-Philippe Steinmetz <jp@example.com>')).toBeNull();
    expect(classifyChangelogLine('Reviewed-by: Someone <someone@example.com>')).toBeNull();
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
    expect(content).toBe('# Release Notes\n\n## Unreleased\n\n## v1.2.4\n\n- X\n');
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
    expect(values).toBe('service:\n  image:\n    tag: "1.2.4"\n    repository: ghcr.io/x\n');
    const chart = await readFile(join(tmpDir, 'helm', 'Chart.yaml'), 'utf-8');
    expect(chart).toBe('apiVersion: v2\nname: x\nappVersion: "1.2.4"\nversion: 0.1.0\n');
  });

  it('keeps comments, formatting and other values in the Helm files', async () => {
    await mkdir(join(tmpDir, 'helm'), { recursive: true });
    const values = [
      '# Top comment',
      'host: localhost # trailing comment',
      'authServer:',
      '  service:',
      '    image:',
      '      tag: 9.9.9 # not this one',
      'service:',
      '  # The server image.',
      '  image:',
      '    registry: ghcr.io',
      '    notes: |',
      '      tag: 7.7.7',
      '    tag: 1.0.0-beta.2   # set by release',
      '  ports:',
      '    - name: http',
      '      tag: 8.8.8',
      '',
    ].join('\n');
    await writeFile(join(tmpDir, 'helm', 'values.yaml'), values);
    const chart = 'apiVersion: v2\ndescription: >-\n  Folded\n  text # kept\nname: x\nversion: 1.0.0\nappVersion: 1.0.0-beta.2\n';
    await writeFile(join(tmpDir, 'helm', 'Chart.yaml'), chart);

    await updateHelmVersion(tmpDir, '1.0.0-beta.3');

    expect(await readFile(join(tmpDir, 'helm', 'values.yaml'), 'utf-8')).toBe(
      values.replace('    tag: 1.0.0-beta.2   # set by release', '    tag: 1.0.0-beta.3   # set by release'),
    );
    expect(await readFile(join(tmpDir, 'helm', 'Chart.yaml'), 'utf-8')).toBe(
      chart.replace('appVersion: 1.0.0-beta.2', 'appVersion: 1.0.0-beta.3'),
    );
  });

  it("updates only the README's own image tag and chart version, not sibling projects' at the same version", async () => {
    await writeHelmFiles();
    const readme = (tag: string) =>
      [
        '| Docker Image |                       |',
        '| ------------ | :-------------------: |',
        '| Registry     | ghcr.io |',
        '| Repository   | /rapidmx/x |',
        `| Tag          | ${tag} |`,
        '',
        '| Dependency | Tag |',
        '| ---------- | --- |',
        '| Tag        | 1.0.0 |',
        '',
        'Local only (`127.0.0.1`).',
        '',
        '```bash',
        `helm install --namespace x x oci://ghcr.io/rapidmx/charts/x --version ${tag}   --set a=b`,
        'helm install --namespace x bridge oci://ghcr.io/rapidmx/charts/x-bridge --version 1.0.0',
        '```',
        '',
        'Needs ghcr.io/rapidmx/y:1.0.0 and @rapidmx/restapi 1.0.0.',
        '',
      ].join('\n');
    await writeFile(join(tmpDir, 'README.md'), readme('1.0.0'));

    await updateHelmVersion(tmpDir, '1.0.1');

    expect(await readFile(join(tmpDir, 'README.md'), 'utf-8')).toBe(readme('1.0.1'));
  });

  it("updates only the install script's own VERSION assignment, keeping its quoting", async () => {
    await writeHelmFiles();
    await writeFile(
      join(tmpDir, 'single_node_install.sh'),
      "#!/bin/sh\nVERSION='1.0.0'\nOTHER_VERSION=\"2.0.0\"\nENVOY_VERSION=${ENVOY_VERSION:-v1.9.1}\necho \"VERSION=3.0.0\"\n",
    );

    await updateHelmVersion(tmpDir, '1.2.4');

    expect(await readFile(join(tmpDir, 'single_node_install.sh'), 'utf-8')).toBe(
      "#!/bin/sh\nVERSION='1.2.4'\nOTHER_VERSION=\"2.0.0\"\nENVOY_VERSION=${ENVOY_VERSION:-v1.9.1}\necho \"VERSION=3.0.0\"\n",
    );
  });

  it('also updates single_node_install.sh and README.md when present, and reports them as touched', async () => {
    await writeHelmFiles();
    await writeFile(join(tmpDir, 'single_node_install.sh'), '#!/bin/sh\nVERSION="1.0.0"\necho "$VERSION"\n');
    await writeFile(
      join(tmpDir, 'README.md'),
      '# X\n\n| Repository | /x |\n| Tag | 1.0.0 |\n\nhelm install x oci://ghcr.io/o/charts/x --version 1.0.0\n',
    );

    const touched = await updateHelmVersion(tmpDir, '1.2.4');
    expect(touched).toEqual(
      expect.arrayContaining([join('helm', 'values.yaml'), join('helm', 'Chart.yaml'), 'single_node_install.sh', 'README.md']),
    );

    const script = await readFile(join(tmpDir, 'single_node_install.sh'), 'utf-8');
    expect(script).toContain('VERSION="1.2.4"');
    const readme = await readFile(join(tmpDir, 'README.md'), 'utf-8');
    expect(readme).toBe('# X\n\n| Repository | /x |\n| Tag | 1.2.4 |\n\nhelm install x oci://ghcr.io/o/charts/x --version 1.2.4\n');
  });

  it('skips single_node_install.sh and README.md when neither exists', async () => {
    await writeHelmFiles();
    const touched = await updateHelmVersion(tmpDir, '1.2.4');
    expect(touched).not.toContain('single_node_install.sh');
    expect(touched).not.toContain('README.md');
  });
});

describe('setYamlScalar', () => {
  it('keeps the line ending style and a comment after an empty value', () => {
    expect(setYamlScalar('a:\r\n  b: # set me\r\n  c: 1\r\n', ['a', 'b'], '2.0.0')).toBe('a:\r\n  b: 2.0.0 # set me\r\n  c: 1\r\n');
  });

  it('handles quoted keys and single-quoted values with escaped quotes', () => {
    expect(setYamlScalar("\"a\":\n  'b': 'it''s # 1.0.0'\n", ['a', 'b'], '2.0.0')).toBe("\"a\":\n  'b': '2.0.0'\n");
  });

  it("adds a missing key under its parent at the children's indentation", () => {
    expect(setYamlScalar('service:\n  image:\n      registry: ghcr.io\nother: 1\n', ['service', 'image', 'tag'], '1.2.4')).toBe(
      'service:\n  image:\n      tag: 1.2.4\n      registry: ghcr.io\nother: 1\n',
    );
  });

  it('adds a missing top-level key at the end', () => {
    expect(setYamlScalar('apiVersion: v2\nname: x\n', ['appVersion'], '1.2.4')).toBe('apiVersion: v2\nname: x\nappVersion: 1.2.4\n');
  });

  it("throws rather than guess when the value can't be edited in place or the parent is missing", () => {
    expect(() => setYamlScalar('service:\n  image:\n    tag: &t 1.0.0\n', ['service', 'image', 'tag'], '1.2.4')).toThrow(
      /isn't a plain or quoted scalar/,
    );
    expect(() => setYamlScalar('other: 1\n', ['service', 'image', 'tag'], '1.2.4')).toThrow(/doesn't exist/);
    expect(() => setYamlScalar('service:\n  image: {}\n', ['service', 'image', 'tag'], '1.2.4')).toThrow(/expected value/);
  });
});

describe('updateReadmeVersion', () => {
  it('keeps the Tag column width, and widens it only when the new version is longer', () => {
    const table = (tag: string) => `| Repository | /x |\n| Tag        | ${tag} |\n`;
    expect(updateReadmeVersion('| Repository | /x |\n| Tag        | 1.0.0-beta.3 |\n', 'x', '1.0.0')).toBe(
      '| Repository | /x |\n| Tag        | 1.0.0        |\n',
    );
    expect(updateReadmeVersion(table('1.0.0'), 'x', '1.0.0-beta.4')).toBe(table('1.0.0-beta.4'));
  });

  it('keeps CRLF line endings and accepts --version=', () => {
    expect(
      updateReadmeVersion('| Repository | /x |\r\n| Tag | 1.0.0 |\r\noci://h/charts/x --version=1.0.0\r\n', 'x', '2.0.0'),
    ).toBe('| Repository | /x |\r\n| Tag | 2.0.0 |\r\noci://h/charts/x --version=2.0.0\r\n');
  });

  it('changes nothing without a Docker Image table or this chart reference', () => {
    const text = '| Name | Tag |\n| Tag | 1.0.0 |\n\nhelm install y oci://h/charts/xy --version 1.0.0\nsee charts/x docs 1.0.0\n';
    expect(updateReadmeVersion(text, 'x', '2.0.0')).toBe(text);
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
