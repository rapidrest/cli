///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi } from 'vitest';
import {
  createVersionResolver,
  fetchPublishedVersions,
  isResolvableRange,
  resolvePackageJsonRanges,
  type FetchVersions,
} from '../../src/lib/versionResolve.js';

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, request: vi.fn() };
});
import { request } from 'undici';

describe('isResolvableRange', () => {
  it('accepts a major-only caret, and a major.minor caret for 0.x', () => {
    expect(isResolvableRange('^6')).toBe(true);
    expect(isResolvableRange('^0.13')).toBe(true);
    expect(isResolvableRange('^1.2')).toBe(true);
  });

  it('rejects ^0 alone, full versions, and anything else', () => {
    for (const range of ['^0', '^6.1.0', '~6', '6.x', 'latest', '*', '^6.1.0-beta.1', 'github:a/b']) {
      expect(isResolvableRange(range)).toBe(false);
    }
  });
});

describe('createVersionResolver', () => {
  const versions: FetchVersions = async (name) => ({
    a: ['6.0.0', '6.2.1', '6.10.0', '7.0.0', '7.1.0-beta.1'],
    zero: ['0.13.0', '0.13.4', '0.14.0'],
  } as Record<string, string[]>)[name] ?? [];

  it('resolves a resolvable range to the newest non-prerelease release it allows', async () => {
    const warn = vi.fn();
    const resolver = createVersionResolver(warn, versions);
    expect(await resolver.resolve('a', '^6')).toBe('^6.10.0');
    expect(await resolver.resolve('a', '^7')).toBe('^7.0.0');
    expect(await resolver.resolve('a', '^8')).toBe('^8');
    expect(await resolver.resolve('zero', '^0.13')).toBe('^0.13.4');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('no published version matches ^8');
    await resolver.close();
  });

  it('writes any other range as is, without a lookup', async () => {
    const fetch = vi.fn(versions);
    const resolver = createVersionResolver(vi.fn(), fetch);
    expect(await resolver.resolve('a', '^6.1.0')).toBe('^6.1.0');
    expect(await resolver.resolve('a', '~1.1.0')).toBe('~1.1.0');
    expect(fetch).not.toHaveBeenCalled();
    await resolver.close();
  });

  it('caches lookups and keeps the range when the registry fails', async () => {
    const fetch = vi.fn<FetchVersions>(async () => { throw new Error('offline'); });
    const warn = vi.fn();
    const resolver = createVersionResolver(warn, fetch);
    expect(await resolver.resolve('a', '^6')).toBe('^6');
    expect(await resolver.resolve('a', '^6')).toBe('^6');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Could not resolve the latest version of a (offline); writing "^6".');
    await resolver.close();
    await resolver.close();
  });

  it('reports a non-Error failure as a string', async () => {
    const warn = vi.fn();
    // eslint-disable-next-line no-throw-literal -- deliberately not an Error
    const resolver = createVersionResolver(warn, async () => { throw 'boom'; });
    await resolver.resolve('a', '^6');
    expect(warn.mock.calls[0][0]).toContain('(boom)');
  });
});

describe('resolvePackageJsonRanges', () => {
  it('resolves every dependency section and leaves everything else alone', async () => {
    const pkg: Record<string, unknown> = {
      name: 'x',
      dependencies: { a: '^6', b: '1.0.0' },
      devDependencies: { c: '^2' },
      peerDependencies: { d: '^3' },
      optionalDependencies: { e: 5 },
      resolutions: { f: '^4' },
    };
    await resolvePackageJsonRanges(pkg, async (name, range) => (range.length === 2 ? `${range}.9.9-${name}` : range));
    expect(pkg).toEqual({
      name: 'x',
      dependencies: { a: '^6.9.9-a', b: '1.0.0' },
      devDependencies: { c: '^2.9.9-c' },
      peerDependencies: { d: '^3.9.9-d' },
      optionalDependencies: { e: 5 },
      resolutions: { f: '^4' },
    });
  });
});

describe('fetchPublishedVersions', () => {
  const body = (data: unknown) => ({ json: async () => data, dump: vi.fn(async () => undefined) });

  it('lists the versions from the abbreviated package document, scope-encoded', async () => {
    delete process.env.npm_config_registry;
    vi.mocked(request).mockResolvedValueOnce({ statusCode: 200, body: body({ versions: { '1.0.0': {}, '1.1.0': {} } }) } as never);
    expect(await fetchPublishedVersions('@rapidrest/core', {} as never)).toEqual(['1.0.0', '1.1.0']);
    const [url, opts] = vi.mocked(request).mock.calls[0];
    expect(url).toBe('https://registry.npmjs.org/@rapidrest%2fcore');
    expect((opts as { headers: Record<string, string> }).headers.Accept).toBe('application/vnd.npm.install-v1+json');
  });

  it('uses npm_config_registry and copes with a document without versions', async () => {
    process.env.npm_config_registry = 'https://mirror.example/npm/';
    vi.mocked(request).mockResolvedValueOnce({ statusCode: 200, body: body({}) } as never);
    try {
      expect(await fetchPublishedVersions('a', {} as never)).toEqual([]);
      expect(vi.mocked(request).mock.calls[0][0]).toBe('https://mirror.example/npm/a');
    } finally {
      delete process.env.npm_config_registry;
    }
  });

  it('throws on a non-2xx response after draining it', async () => {
    const b = body({});
    vi.mocked(request).mockResolvedValueOnce({ statusCode: 404, body: b } as never);
    await expect(fetchPublishedVersions('a', {} as never)).rejects.toThrow('HTTP 404');
    expect(b.dump).toHaveBeenCalled();
  });
});
