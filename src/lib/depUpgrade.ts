///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Agent, request, type Dispatcher } from 'undici';

export type DependencySection = 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';

// peerDependencies is deliberately excluded from the default scope — bumping a peer range is a
// compatibility promise about your own package, not just "install something newer", so it's
// opt-in via --peer. It's still searched when a package is named explicitly (see resolveTargets).
export const DEFAULT_UPGRADE_SECTIONS: DependencySection[] = ['dependencies', 'devDependencies', 'optionalDependencies'];
export const ALL_DEPENDENCY_SECTIONS: DependencySection[] = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

export interface RequestedPackage {
  name: string;
  /** An explicit version pinned via `name@version` or `name:version` on the command line. */
  pinnedVersion?: string;
}

// Parses one `dep upgrade` argument: a bare package name ("lodash-es"), or one pinned to an
// exact version via "name@version" or "name:version". Handles scoped package names
// ("@rapidrest/core@5.2.0") by only treating the *second* "@" as the version separator — the
// first one, at index 0, is part of the scope.
export function parsePackageSpec(spec: string): RequestedPackage {
  const colonIdx = spec.indexOf(':');
  if (colonIdx !== -1) {
    return { name: spec.slice(0, colonIdx), pinnedVersion: spec.slice(colonIdx + 1) };
  }
  const atIdx = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  if (atIdx !== -1) {
    return { name: spec.slice(0, atIdx), pinnedVersion: spec.slice(atIdx + 1) };
  }
  return { name: spec };
}

const RANGE_PREFIX_RE = /^(\^|~|>=|<=|>|<)/;
// Specifiers that aren't a plain semver range and can't be safely rewritten to a new version.
const NON_UPGRADABLE_RE = /^(workspace:|npm:|file:|link:|git\+|git:|github:|https?:|catalog:)/;

// Rewrites `currentSpec` to point at `newVersion`, preserving its existing range operator (e.g.
// "^1.2.3" -> "^1.4.0"; "1.2.3" -> "1.4.0" stays exact). Returns undefined for specs this can't
// safely rewrite: wildcards/tags, workspace/git/file/catalog protocols, and compound ranges (OR
// groups, hyphen ranges, multiple space-separated comparators) — those are left for the user to
// update by hand rather than risk mangling them.
export function formatUpgradedSpec(currentSpec: string, newVersion: string): string | undefined {
  const trimmed = currentSpec.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === 'latest') return undefined;
  if (NON_UPGRADABLE_RE.test(trimmed)) return undefined;
  if (trimmed.includes('||')) return undefined;

  const match = trimmed.match(RANGE_PREFIX_RE);
  const prefix = match ? match[1] : '';
  const rest = trimmed.slice(prefix.length);
  if (/\s/.test(rest)) return undefined; // compound range (e.g. ">=1.0.0 <2.0.0", "1.2.3 - 2.3.4")

  return `${prefix}${newVersion}`;
}

export interface UpgradePlanEntry {
  name: string;
  section: DependencySection;
  currentSpec: string;
  newSpec: string;
  pinned: boolean;
}

export interface UpgradeSkip {
  name: string;
  section?: DependencySection;
  reason: string;
}

export interface UpgradePlan {
  upgrades: UpgradePlanEntry[];
  skipped: UpgradeSkip[];
}

export type PackageJsonDependencies = Partial<Record<DependencySection, Record<string, string>>>;

// Runs `fn` over `items` with at most `limit` in flight at once — a mass upgrade can easily
// touch 50+ packages, and firing that many registry requests at once is both rude to the
// registry and prone to spurious failures.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// Looks up a package's "latest" dist-tag on the npm registry. Requests the abbreviated
// (install-v1) metadata format, which is far smaller than the full package document — this only
// needs dist-tags, not every published version's manifest.
//
// Deliberately uses undici's request() with a caller-supplied Agent rather than the global
// fetch() — the global fetch's shared keep-alive dispatcher triggers a native libuv assertion
// crash ("UV_HANDLE_CLOSING" in src/win/async.c) on process exit on Windows/Node 24. Passing a
// short-lived Agent that the caller closes once every lookup is done avoids it.
export async function fetchLatestVersion(pkgName: string, dispatcher?: Dispatcher): Promise<string> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}`;
  let res: Dispatcher.ResponseData;
  try {
    res = await request(url, { headers: { Accept: 'application/vnd.npm.install-v1+json' }, dispatcher });
  } catch (e) {
    throw new Error(`Could not reach the npm registry for "${pkgName}": ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) {
    await res.body.dump(); // drain the body so the connection can be released
    throw new Error(`npm registry lookup for "${pkgName}" failed (HTTP ${res.statusCode}).`);
  }
  const data = await res.body.json() as { 'dist-tags'?: { latest?: string } };
  const latest = data['dist-tags']?.latest;
  if (!latest) {
    throw new Error(`No "latest" version found for "${pkgName}" on the npm registry.`);
  }
  return latest;
}

// Resolves every (name, section) pair this upgrade should consider: every dependency in
// `sections` when `requested` is empty, or just the named packages (searched across every
// section regardless of `sections`, since explicitly naming a package is a deliberate choice the
// default section scoping shouldn't silently override) otherwise.
function resolveTargets(
  pkg: PackageJsonDependencies,
  requested: RequestedPackage[],
  sections: DependencySection[],
): { pairs: { name: string; section: DependencySection; pinnedVersion?: string }[]; skipped: UpgradeSkip[] } {
  const pairs: { name: string; section: DependencySection; pinnedVersion?: string }[] = [];
  const skipped: UpgradeSkip[] = [];

  if (requested.length === 0) {
    for (const section of sections) {
      for (const name of Object.keys(pkg[section] ?? {})) {
        pairs.push({ name, section });
      }
    }
    return { pairs, skipped };
  }

  for (const { name, pinnedVersion } of requested) {
    const foundSections = ALL_DEPENDENCY_SECTIONS.filter((section) => pkg[section]?.[name] !== undefined);
    if (foundSections.length === 0) {
      skipped.push({ name, reason: 'not a dependency of this project' });
      continue;
    }
    for (const section of foundSections) {
      pairs.push({ name, section, pinnedVersion });
    }
  }

  return { pairs, skipped };
}

export interface BuildUpgradePlanOptions {
  sections?: DependencySection[];
  concurrency?: number;
  /** Package names to leave untouched, even if they'd otherwise be targeted (default scan or explicitly requested). */
  exclude?: string[];
}

// Builds the full upgrade plan: for each targeted dependency, resolves its new version spec (an
// explicit pin as-is, or the npm registry's current "latest" reformatted to match the existing
// range style) and reports anything it can't or won't touch instead of guessing.
export async function buildUpgradePlan(
  pkg: PackageJsonDependencies,
  requested: RequestedPackage[],
  opts: BuildUpgradePlanOptions = {},
): Promise<UpgradePlan> {
  const sections = opts.sections ?? DEFAULT_UPGRADE_SECTIONS;
  const { pairs: allPairs, skipped } = resolveTargets(pkg, requested, sections);

  const excludeSet = new Set(opts.exclude ?? []);
  const pairs = allPairs.filter((p) => {
    if (!excludeSet.has(p.name)) return true;
    skipped.push({ name: p.name, section: p.section, reason: 'excluded via --exclude' });
    return false;
  });

  // Dedupe registry lookups — the same package can appear in more than one section.
  const namesNeedingLookup = [...new Set(pairs.filter((p) => !p.pinnedVersion).map((p) => p.name))];
  const latestByName = new Map<string, string | Error>();
  if (namesNeedingLookup.length > 0) {
    // A short-lived Agent shared across every lookup in this call, closed once they're all
    // done — see fetchLatestVersion's comment for why this can't just be the global fetch().
    const agent = new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1 });
    try {
      await mapWithConcurrency(namesNeedingLookup, opts.concurrency ?? 8, async (name) => {
        try {
          latestByName.set(name, await fetchLatestVersion(name, agent));
        } catch (e) {
          latestByName.set(name, e instanceof Error ? e : new Error(String(e)));
        }
      });
    } finally {
      await agent.close();
    }
  }

  const upgrades: UpgradePlanEntry[] = [];
  for (const { name, section, pinnedVersion } of pairs) {
    const currentSpec = pkg[section]![name];

    let newSpec: string | undefined;
    if (pinnedVersion) {
      newSpec = pinnedVersion;
    } else {
      const resolved = latestByName.get(name)!;
      if (resolved instanceof Error) {
        skipped.push({ name, section, reason: resolved.message });
        continue;
      }
      newSpec = formatUpgradedSpec(currentSpec, resolved);
      if (!newSpec) {
        skipped.push({
          name,
          section,
          reason: `package.json range "${currentSpec}" is too complex to upgrade automatically — update it by hand`,
        });
        continue;
      }
    }

    if (newSpec === currentSpec) {
      skipped.push({ name, section, reason: `already up to date (${currentSpec})` });
      continue;
    }

    upgrades.push({ name, section, currentSpec, newSpec, pinned: Boolean(pinnedVersion) });
  }

  return { upgrades, skipped };
}

// Writes the resolved upgrade plan into package.json's dependency sections (mutates `data` — the
// caller is expected to have read it via readProjectPackageJson and to write it back afterward).
export function applyUpgradePlan(data: Record<string, unknown>, upgrades: UpgradePlanEntry[]): void {
  for (const { name, section, newSpec } of upgrades) {
    const target = data[section] as Record<string, string> | undefined;
    if (!target) continue;
    target[name] = newSpec;
  }
}
