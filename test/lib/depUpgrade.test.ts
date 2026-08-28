///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach } from 'vitest';

// depUpgrade.ts deliberately uses undici's request()/Agent instead of the global fetch() — see
// fetchLatestVersion's comment in the source for why (a Windows/Node 24 libuv crash on exit).
vi.mock('undici', () => ({
  // A regular function, not an arrow function — vi.fn()'s mock implementation is invoked via
  // `new Agent(...)` in the source, and arrow functions can't be used as constructors.
  Agent: vi.fn().mockImplementation(function AgentMock() {
    return { close: vi.fn().mockResolvedValue(undefined) };
  }),
  request: vi.fn(),
}));

import { request } from 'undici';
import {
  applyUpgradePlan,
  buildUpgradePlan,
  fetchLatestVersion,
  formatUpgradedSpec,
  parsePackageSpec,
  type PackageJsonDependencies,
} from '../../src/lib/depUpgrade.js';

function mockResponse(statusCode: number, body: unknown): any {
  return { statusCode, body: { json: async () => body, dump: async () => undefined } };
}

describe('parsePackageSpec', () => {
  it('parses a bare package name with no version', () => {
    expect(parsePackageSpec('lodash-es')).toEqual({ name: 'lodash-es' });
  });

  it('parses "name@version"', () => {
    expect(parsePackageSpec('lodash-es@4.17.21')).toEqual({ name: 'lodash-es', pinnedVersion: '4.17.21' });
  });

  it('parses "name:version"', () => {
    expect(parsePackageSpec('lodash-es:4.17.21')).toEqual({ name: 'lodash-es', pinnedVersion: '4.17.21' });
  });

  it('parses a scoped package name with no version', () => {
    expect(parsePackageSpec('@rapidrest/core')).toEqual({ name: '@rapidrest/core' });
  });

  it('parses a scoped "name@version" without confusing the scope\'s "@"', () => {
    expect(parsePackageSpec('@rapidrest/core@5.2.0')).toEqual({ name: '@rapidrest/core', pinnedVersion: '5.2.0' });
  });

  it('parses a scoped "name:version"', () => {
    expect(parsePackageSpec('@rapidrest/core:5.2.0')).toEqual({ name: '@rapidrest/core', pinnedVersion: '5.2.0' });
  });

  it('parses a version tag as the pinned version (e.g. "next")', () => {
    expect(parsePackageSpec('lodash-es@next')).toEqual({ name: 'lodash-es', pinnedVersion: 'next' });
  });
});

describe('formatUpgradedSpec', () => {
  it('preserves a caret range', () => {
    expect(formatUpgradedSpec('^1.2.3', '1.4.0')).toBe('^1.4.0');
  });

  it('preserves a tilde range', () => {
    expect(formatUpgradedSpec('~1.2.3', '1.2.9')).toBe('~1.2.9');
  });

  it('keeps an exact pin exact', () => {
    expect(formatUpgradedSpec('1.2.3', '1.4.0')).toBe('1.4.0');
  });

  it('preserves >= and <= operators', () => {
    expect(formatUpgradedSpec('>=1.2.3', '1.4.0')).toBe('>=1.4.0');
    expect(formatUpgradedSpec('<=1.2.3', '1.4.0')).toBe('<=1.4.0');
  });

  it('returns undefined for a wildcard or "latest"', () => {
    expect(formatUpgradedSpec('*', '1.4.0')).toBeUndefined();
    expect(formatUpgradedSpec('latest', '1.4.0')).toBeUndefined();
  });

  it('returns undefined for workspace/git/file/link/catalog protocols', () => {
    expect(formatUpgradedSpec('workspace:*', '1.4.0')).toBeUndefined();
    expect(formatUpgradedSpec('git+https://github.com/foo/bar.git', '1.4.0')).toBeUndefined();
    expect(formatUpgradedSpec('file:../local-pkg', '1.4.0')).toBeUndefined();
    expect(formatUpgradedSpec('link:../local-pkg', '1.4.0')).toBeUndefined();
    expect(formatUpgradedSpec('catalog:', '1.4.0')).toBeUndefined();
    expect(formatUpgradedSpec('npm:other-pkg@1.0.0', '1.4.0')).toBeUndefined();
  });

  it('returns undefined for an OR range', () => {
    expect(formatUpgradedSpec('1.2.3 || 2.0.0', '2.1.0')).toBeUndefined();
  });

  it('returns undefined for a hyphen range', () => {
    expect(formatUpgradedSpec('1.2.3 - 2.3.4', '2.4.0')).toBeUndefined();
  });

  it('returns undefined for a compound comparator range', () => {
    expect(formatUpgradedSpec('>=1.0.0 <2.0.0', '2.1.0')).toBeUndefined();
  });
});

describe('fetchLatestVersion', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
  });

  it('returns the "latest" dist-tag from the registry response', async () => {
    vi.mocked(request).mockResolvedValue(mockResponse(200, { 'dist-tags': { latest: '4.17.21' } }));

    expect(await fetchLatestVersion('lodash-es')).toBe('4.17.21');
    expect(request).toHaveBeenCalledWith(
      'https://registry.npmjs.org/lodash-es',
      expect.objectContaining({ headers: expect.objectContaining({ Accept: expect.stringContaining('install-v1') }) }),
    );
  });

  it('URL-encodes scoped package names', async () => {
    vi.mocked(request).mockResolvedValue(mockResponse(200, { 'dist-tags': { latest: '5.2.0' } }));

    await fetchLatestVersion('@rapidrest/core');

    expect(request).toHaveBeenCalledWith('https://registry.npmjs.org/%40rapidrest%2Fcore', expect.anything());
  });

  it('throws when the registry responds with a non-OK status', async () => {
    vi.mocked(request).mockResolvedValue(mockResponse(404, {}));
    await expect(fetchLatestVersion('nonexistent-pkg')).rejects.toThrow(/HTTP 404/);
  });

  it('throws when the response has no "latest" dist-tag', async () => {
    vi.mocked(request).mockResolvedValue(mockResponse(200, { 'dist-tags': {} }));
    await expect(fetchLatestVersion('weird-pkg')).rejects.toThrow(/No "latest" version/);
  });

  it('throws a descriptive error when the network request itself fails', async () => {
    vi.mocked(request).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    await expect(fetchLatestVersion('lodash-es')).rejects.toThrow(/Could not reach the npm registry/);
  });
});

describe('buildUpgradePlan', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
  });

  function mockRegistry(versions: Record<string, string>): void {
    vi.mocked(request).mockImplementation(async (url) => {
      const name = decodeURIComponent(String(url).replace('https://registry.npmjs.org/', ''));
      const latest = versions[name];
      if (!latest) return mockResponse(404, {});
      return mockResponse(200, { 'dist-tags': { latest } });
    });
  }

  it('upgrades everything in dependencies/devDependencies/optionalDependencies by default (no peerDependencies)', async () => {
    mockRegistry({ 'lodash-es': '4.17.21', typescript: '6.1.0', 'is-odd': '4.0.0' });
    const pkg: PackageJsonDependencies = {
      dependencies: { 'lodash-es': '^4.17.0' },
      devDependencies: { typescript: '^6.0.0' },
      optionalDependencies: { 'is-odd': '^3.0.0' },
      peerDependencies: { react: '^18.0.0' },
    };

    const plan = await buildUpgradePlan(pkg, []);

    expect(plan.upgrades).toEqual(expect.arrayContaining([
      { name: 'lodash-es', section: 'dependencies', currentSpec: '^4.17.0', newSpec: '^4.17.21', pinned: false },
      { name: 'typescript', section: 'devDependencies', currentSpec: '^6.0.0', newSpec: '^6.1.0', pinned: false },
      { name: 'is-odd', section: 'optionalDependencies', currentSpec: '^3.0.0', newSpec: '^4.0.0', pinned: false },
    ]));
    expect(plan.upgrades.some((u) => u.name === 'react')).toBe(false);
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining('react'), expect.anything());
  });

  it('includes peerDependencies when explicitly passed in sections', async () => {
    mockRegistry({ react: '19.0.0' });
    const pkg: PackageJsonDependencies = { peerDependencies: { react: '^18.0.0' } };

    const plan = await buildUpgradePlan(pkg, [], { sections: ['peerDependencies'] });

    expect(plan.upgrades).toEqual([
      { name: 'react', section: 'peerDependencies', currentSpec: '^18.0.0', newSpec: '^19.0.0', pinned: false },
    ]);
  });

  it('only targets explicitly requested packages, searching every section (including peer) regardless of `sections`', async () => {
    mockRegistry({ react: '19.0.0' });
    const pkg: PackageJsonDependencies = {
      dependencies: { 'lodash-es': '^4.17.0' },
      peerDependencies: { react: '^18.0.0' },
    };

    const plan = await buildUpgradePlan(pkg, [{ name: 'react' }]);

    expect(plan.upgrades).toEqual([
      { name: 'react', section: 'peerDependencies', currentSpec: '^18.0.0', newSpec: '^19.0.0', pinned: false },
    ]);
  });

  it('applies an explicit pin verbatim without a registry lookup', async () => {
    const pkg: PackageJsonDependencies = { dependencies: { 'lodash-es': '^4.17.0' } };

    const plan = await buildUpgradePlan(pkg, [{ name: 'lodash-es', pinnedVersion: '4.17.21' }]);

    expect(plan.upgrades).toEqual([
      { name: 'lodash-es', section: 'dependencies', currentSpec: '^4.17.0', newSpec: '4.17.21', pinned: true },
    ]);
    expect(request).not.toHaveBeenCalled();
  });

  it('skips a requested package that is not a dependency of the project', async () => {
    const pkg: PackageJsonDependencies = { dependencies: { 'lodash-es': '^4.17.0' } };

    const plan = await buildUpgradePlan(pkg, [{ name: 'not-a-real-dep' }]);

    expect(plan.upgrades).toEqual([]);
    expect(plan.skipped).toEqual([{ name: 'not-a-real-dep', reason: 'not a dependency of this project' }]);
  });

  it('skips a package that is already at the latest version', async () => {
    mockRegistry({ 'lodash-es': '4.17.0' });
    const pkg: PackageJsonDependencies = { dependencies: { 'lodash-es': '^4.17.0' } };

    const plan = await buildUpgradePlan(pkg, []);

    expect(plan.upgrades).toEqual([]);
    expect(plan.skipped).toEqual([
      { name: 'lodash-es', section: 'dependencies', reason: 'already up to date (^4.17.0)' },
    ]);
  });

  it('skips a package whose range is too complex to rewrite, without failing the whole plan', async () => {
    mockRegistry({ 'lodash-es': '4.17.21', axios: '1.19.0' });
    const pkg: PackageJsonDependencies = {
      dependencies: { 'lodash-es': '1.0.0 || 2.0.0', axios: '^1.18.0' },
    };

    const plan = await buildUpgradePlan(pkg, []);

    expect(plan.upgrades).toEqual([
      { name: 'axios', section: 'dependencies', currentSpec: '^1.18.0', newSpec: '^1.19.0', pinned: false },
    ]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ name: 'lodash-es', reason: expect.stringContaining('too complex') }),
    ]);
  });

  it('skips a package whose registry lookup fails, without failing the whole plan', async () => {
    mockRegistry({ axios: '1.19.0' }); // lodash-es intentionally absent -> 404
    const pkg: PackageJsonDependencies = {
      dependencies: { 'lodash-es': '^4.17.0', axios: '^1.18.0' },
    };

    const plan = await buildUpgradePlan(pkg, []);

    expect(plan.upgrades).toEqual([
      { name: 'axios', section: 'dependencies', currentSpec: '^1.18.0', newSpec: '^1.19.0', pinned: false },
    ]);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ name: 'lodash-es', reason: expect.stringContaining('HTTP 404') }),
    ]);
  });

  it('deduplicates registry lookups for a package listed in more than one section', async () => {
    mockRegistry({ typescript: '6.1.0' });
    const pkg: PackageJsonDependencies = {
      dependencies: { typescript: '^6.0.0' },
      devDependencies: { typescript: '^6.0.0' },
    };

    const plan = await buildUpgradePlan(pkg, []);

    expect(plan.upgrades).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('excludes a package named via `exclude` from a default full scan, without looking it up', async () => {
    mockRegistry({ axios: '1.19.0' });
    const pkg: PackageJsonDependencies = {
      dependencies: { 'lodash-es': '^4.17.0', axios: '^1.18.0' },
    };

    const plan = await buildUpgradePlan(pkg, [], { exclude: ['lodash-es'] });

    expect(plan.upgrades).toEqual([
      { name: 'axios', section: 'dependencies', currentSpec: '^1.18.0', newSpec: '^1.19.0', pinned: false },
    ]);
    expect(plan.skipped).toEqual([
      { name: 'lodash-es', section: 'dependencies', reason: 'excluded via --exclude' },
    ]);
    expect(request).not.toHaveBeenCalledWith(expect.stringContaining('lodash-es'), expect.anything());
  });

  it('excludes an explicitly requested package too, overriding the request', async () => {
    const pkg: PackageJsonDependencies = { dependencies: { 'lodash-es': '^4.17.0' } };

    const plan = await buildUpgradePlan(pkg, [{ name: 'lodash-es' }], { exclude: ['lodash-es'] });

    expect(plan.upgrades).toEqual([]);
    expect(plan.skipped).toEqual([
      { name: 'lodash-es', section: 'dependencies', reason: 'excluded via --exclude' },
    ]);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('applyUpgradePlan', () => {
  it('writes each upgrade\'s newSpec into its section', () => {
    const data: Record<string, unknown> = {
      dependencies: { 'lodash-es': '^4.17.0' },
      devDependencies: { typescript: '^6.0.0' },
    };

    applyUpgradePlan(data, [
      { name: 'lodash-es', section: 'dependencies', currentSpec: '^4.17.0', newSpec: '^4.17.21', pinned: false },
      { name: 'typescript', section: 'devDependencies', currentSpec: '^6.0.0', newSpec: '6.1.0', pinned: true },
    ]);

    expect(data).toEqual({
      dependencies: { 'lodash-es': '^4.17.21' },
      devDependencies: { typescript: '6.1.0' },
    });
  });

  it('does not throw if a section is missing on the target object', () => {
    const data: Record<string, unknown> = {};
    expect(() => applyUpgradePlan(data, [
      { name: 'lodash-es', section: 'dependencies', currentSpec: '^4.17.0', newSpec: '^4.17.21', pinned: false },
    ])).not.toThrow();
  });
});
