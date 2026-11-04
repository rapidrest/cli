///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { maxSatisfying, prerelease } from 'semver';
import { Agent, request, type Dispatcher } from 'undici';

// Templates write a dependency they want kept current as a major-only caret range (`^6`), or a
// major.minor one for a 0.x package (`^0.13`, since a 0.x minor is a breaking release). When a
// project is scaffolded, such a range is resolved to the newest published version it allows
// (`^6.1.0`), so a dependency bump never needs a templates release. Anything else — an exact pin,
// a full `^6.1.0`, a tag, a URL — is written exactly as the template has it.
const RESOLVABLE_RANGE = /^\^(\d+)(\.\d+)?$/;

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** Resolves one dependency's range. Returns the range to write. */
export type ResolveVersion = (name: string, range: string) => Promise<string>;

export function isResolvableRange(range: string): boolean {
  const match = RESOLVABLE_RANGE.exec(range);
  // `^0` alone would allow every breaking 0.x minor, so a 0.x package must name its minor.
  return !!match && (match[1] !== '0' || match[2] !== undefined);
}

/** Fetches every published version of a package. Injectable for tests. */
export type FetchVersions = (name: string, dispatcher: Dispatcher) => Promise<string[]>;

// Requests the abbreviated (install-v1) package document, which lists every version without each
// one's full manifest. Uses undici's request() with a caller-owned Agent rather than the global
// fetch(): see fetchLatestVersion() in depUpgrade.ts for the Windows exit crash that avoids.
export const fetchPublishedVersions: FetchVersions = async (name, dispatcher) => {
  const registry = (process.env.npm_config_registry || 'https://registry.npmjs.org').replace(/\/+$/, '');
  const res = await request(`${registry}/${name.replace('/', '%2f')}`, {
    headers: { Accept: 'application/vnd.npm.install-v1+json' },
    dispatcher,
  });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    await res.body.dump();
    throw new Error(`HTTP ${res.statusCode}`);
  }
  const data = await res.body.json() as { versions?: Record<string, unknown> };
  return Object.keys(data.versions ?? {});
};

export interface VersionResolver {
  resolve: ResolveVersion;
  /** Releases the HTTP connections. Call once scaffolding is done. */
  close(): Promise<void>;
}

/**
 * Creates a resolver for scaffold-time dependency ranges. A lookup that fails (offline, registry
 * error, no matching version) leaves the range as written, which is still a valid range, and warns
 * once per package. Lookups are cached for the resolver's lifetime.
 */
export function createVersionResolver(
  warn: (message: string) => void,
  fetchVersions: FetchVersions = fetchPublishedVersions,
): VersionResolver {
  let agent: Agent | undefined;
  const cache = new Map<string, Promise<string>>();

  const lookup = async (name: string, range: string): Promise<string> => {
    try {
      agent ??= new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1 });
      const versions = (await fetchVersions(name, agent)).filter((v) => !prerelease(v));
      const best = maxSatisfying(versions, range);
      if (!best) throw new Error(`no published version matches ${range}`);
      return `^${best}`;
    } catch (e) {
      warn(`Could not resolve the latest version of ${name} (${e instanceof Error ? e.message : String(e)}); writing "${range}".`);
      return range;
    }
  };

  return {
    resolve: async (name, range) => {
      if (!isResolvableRange(range)) return range;
      const key = `${name}@${range}`;
      if (!cache.has(key)) cache.set(key, lookup(name, range));
      return cache.get(key)!;
    },
    close: async () => {
      await agent?.close();
      agent = undefined;
    },
  };
}

/** Resolves every scaffold-time range in a package.json's dependency sections, in place. */
export async function resolvePackageJsonRanges(
  pkg: Record<string, unknown>,
  resolve: ResolveVersion,
): Promise<Record<string, unknown>> {
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = pkg[section];
    if (!deps || typeof deps !== 'object') continue;
    const entries = Object.entries(deps as Record<string, unknown>);
    const resolved = await Promise.all(entries.map(async ([name, range]) =>
      [name, typeof range === 'string' ? await resolve(name, range) : range] as const));
    pkg[section] = Object.fromEntries(resolved);
  }
  return pkg;
}
