///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { access, copyFile, mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { minVersion } from 'semver';
import { extractDatastoreInfo } from './project.js';

export type Severity = 'error' | 'warning';

export interface Finding {
  /** Stable identifier for the specific problem found (matches the owning Check's id). */
  id: string;
  severity: Severity;
  message: string;
  /** Path to the offending file, relative to the project root, when applicable. */
  file?: string;
  /** Present only when --fix can resolve this finding safely and mechanically. */
  fix?: () => Promise<void>;
}

export interface CheckContext {
  /** The project directory being checked (defaults to process.cwd() by the caller). */
  cwd: string;
  /** The CLI's own installation root (`this.config.root`), used only by checks whose fix needs
   * to copy a canonical file out of the CLI's bundled `templates/` — e.g. a missing vitest.config.ts. */
  templatesDir: string;
}

export interface Check {
  id: string;
  description: string;
  run(ctx: CheckContext): Promise<Finding[]>;
}

// Known-good versions used when a --fix needs to add a dependency the project is missing
// entirely. Kept in sync with templates/server/package.json by hand — there's no automated link
// between the two, so if that file's pins move, update these too.
const TYPEORM_VERSION = '^1.1.0';
const REDIS_VERSION = '^6.2.1';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(cwd: string): Promise<PackageJsonShape | undefined> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return undefined;
  }
}

async function writePackageJson(cwd: string, pkg: PackageJsonShape & Record<string, unknown>): Promise<void> {
  await writeFile(join(cwd, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
}

// Walks a config.ts-style `datastores: { ... }` block the same way extractDatastoreInfo() does,
// but returns each entry's full source text (not just name/type) so checks can inspect the whole
// block — e.g. to confirm a `host:` key is present anywhere inside it.
function extractDatastoreBlocks(source: string): { name: string; body: string }[] {
  const idx = source.search(/\bdatastores\s*:\s*\{/);
  if (idx === -1) return [];

  const braceStart = source.indexOf('{', idx) + 1;
  let depth = 1;
  let i = braceStart;
  const result: { name: string; body: string }[] = [];
  let currentName = '';
  let bodyStart = -1;

  while (i < source.length && depth > 0) {
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const q = source[i++];
      while (i < source.length && source[i] !== q) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }

    if (source[i] === '{') {
      if (depth === 1 && currentName) bodyStart = i + 1;
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
      if (depth === 1 && currentName) {
        result.push({ name: currentName, body: source.slice(bodyStart, i) });
        currentName = '';
      }
    } else if (depth === 1) {
      const propMatch = source.slice(i).match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (propMatch) {
        currentName = propMatch[1];
        i += propMatch[1].length;
        continue;
      }
    }
    i++;
  }

  return result;
}

async function readConfigFiles(cwd: string): Promise<{ path: string; rel: string; content: string }[]> {
  const candidates = [
    { rel: join('src', 'config.ts'), path: join(cwd, 'src', 'config.ts') },
    { rel: join('test', 'config.ts'), path: join(cwd, 'test', 'config.ts') },
  ];
  const found: { path: string; rel: string; content: string }[] = [];
  for (const c of candidates) {
    try {
      const content = await readFile(c.path, 'utf-8');
      found.push({ path: c.path, rel: c.rel.replace(/\\/g, '/'), content });
    } catch {
      // config file doesn't exist at this path — not every project has test/config.ts, skip
    }
  }
  return found;
}

// Check 1: TypeORM's actual driver literals are "postgres"/"better-sqlite3", not the CLI's own
// "postgresql"/"sqlite" feature-flag names. A project whose config.ts still uses the feature
// names fails to connect to its SQL datastore entirely (see .claude/NOTES.md).
const wrongSqlTypeLiteral: Check = {
  id: 'sql-type-literal',
  description: 'config.ts datastore `type` must be TypeORM\'s own driver literal',
  async run({ cwd }) {
    const findings: Finding[] = [];
    const files = await readConfigFiles(cwd);
    const replacements: [RegExp, string][] = [
      [/(\btype\s*:\s*["'])postgresql(["'])/g, '$1postgres$2'],
      [/(\btype\s*:\s*["'])sqlite(["'])/g, '$1better-sqlite3$2'],
    ];

    for (const file of files) {
      const entries = extractDatastoreInfo(file.content);
      const bad = entries.filter((e) => e.type === 'postgresql' || e.type === 'sqlite');
      for (const entry of bad) {
        const correct = entry.type === 'postgresql' ? 'postgres' : 'better-sqlite3';
        findings.push({
          id: 'sql-type-literal',
          severity: 'error',
          file: file.rel,
          message: `Datastore "${entry.name}" has type: "${entry.type}", but TypeORM's driver literal is "${correct}" — this datastore will fail to connect. Run with --fix, or edit ${file.rel} directly.`,
          fix: async () => {
            let content = await readFile(file.path, 'utf-8');
            for (const [pattern, replacement] of replacements) {
              content = content.replace(pattern, replacement);
            }
            await writeFile(file.path, content, 'utf-8');
          },
        });
      }
    }
    return findings;
  },
};

// Check 2: better-sqlite3 is file-based and never actually uses a `host`, but
// ConnectionManager.buildConnectionUri() (service-core) throws unconditionally without one
// (unless `url` is set instead).
const missingSqliteHost: Check = {
  id: 'sqlite-missing-host',
  description: 'better-sqlite3 datastores need a placeholder `host` field',
  async run({ cwd }) {
    const findings: Finding[] = [];
    const files = await readConfigFiles(cwd);

    for (const file of files) {
      const blocks = extractDatastoreBlocks(file.content);
      for (const block of blocks) {
        const isSqlite = /\btype\s*:\s*["']better-sqlite3["']/.test(block.body);
        const hasHostOrUrl = /\bhost\s*:|\burl\s*:/.test(block.body);
        if (isSqlite && !hasHostOrUrl) {
          findings.push({
            id: 'sqlite-missing-host',
            severity: 'error',
            file: file.rel,
            message: `Datastore "${block.name}" is better-sqlite3 but has no host/url field — ConnectionManager.buildConnectionUri() will throw. Add host: "localhost" (a harmless placeholder).`,
            fix: async () => {
              const content = await readFile(file.path, 'utf-8');
              // block.body is the exact substring scanned above — use it as a literal anchor
              // (rather than reconstructing a regex from block.name) so the replacement can only
              // ever land inside this specific datastore's own object body.
              const bodyIndex = content.indexOf(block.body);
              if (bodyIndex === -1) return; // file changed since scanning; don't guess, skip
              // Always insert a comma after the type literal ourselves — the source may or may not
              // already have one (a trailing comma only appears when `type` isn't the last property),
              // and the optional group here just swallows an existing one so we never emit two.
              const updatedBody = block.body.replace(
                /(\btype\s*:\s*["']better-sqlite3["']),?/,
                '$1,\n            host: "localhost",',
              );
              const updated = content.slice(0, bodyIndex) + updatedBody + content.slice(bodyIndex + block.body.length);
              await writeFile(file.path, updated, 'utf-8');
            },
          });
        }
      }
    }
    return findings;
  },
};

// Check 3: without vitest.config.ts (specifically its SWC decorator-transform plugin), vitest's
// default esbuild transform can't reliably handle the decorator syntax every model/route template
// produces — every generated project's test suite fails before this file exists.
const missingVitestConfig: Check = {
  id: 'missing-vitest-config',
  description: 'vitest.config.ts must exist for generated tests to run',
  async run({ cwd, templatesDir }) {
    const target = join(cwd, 'vitest.config.ts');
    if (await fileExists(target)) return [];
    return [
      {
        id: 'missing-vitest-config',
        severity: 'error',
        message: 'vitest.config.ts is missing — vitest\'s default transform cannot handle decorator syntax, so every generated test will fail to even parse. Run with --fix to copy the standard config.',
        fix: async () => {
          const source = join(templatesDir, 'server', 'vitest.config.ts');
          await mkdir(dirname(target), { recursive: true });
          await copyFile(source, target);
        },
      },
    ];
  },
};

// Check 4: @rapidrest/core/service-core's own .d.ts files reference typeorm/redis unconditionally
// regardless of which datastore/cache features a project actually uses — tsc fails to resolve
// their types if the packages aren't installed at all, even as devDependencies.
function missingTypesDependency(pkgName: string, version: string): Check {
  return {
    id: `missing-types-${pkgName}`,
    description: `${pkgName} must be resolvable (dep or devDep) for @rapidrest/service-core's types to type-check`,
    async run({ cwd }) {
      const hasServiceCore = await fileExists(join(cwd, 'node_modules', '@rapidrest', 'service-core'));
      if (!hasServiceCore) return [];

      const pkg = await readPackageJson(cwd);
      if (!pkg) return [];
      const present = !!pkg.dependencies?.[pkgName] || !!pkg.devDependencies?.[pkgName];
      if (present) return [];

      return [
        {
          id: `missing-types-${pkgName}`,
          severity: 'warning',
          file: 'package.json',
          message: `"${pkgName}" isn't declared as a dependency or devDependency — @rapidrest/service-core's type declarations reference it unconditionally, so \`tsc\` will fail to resolve its types even if this project never uses that feature. Run with --fix to add it as a devDependency.`,
          fix: async () => {
            const current = await readPackageJson(cwd);
            if (!current) return;
            const raw = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8')) as Record<string, unknown>;
            const devDeps = { ...(current.devDependencies ?? {}) };
            devDeps[pkgName] = version;
            raw.devDependencies = devDeps;
            await writePackageJson(cwd, raw);
          },
        },
      ];
    },
  };
}

// Check 5: eslint-plugin-import has never published a version supporting eslint@10 (peer range
// caps at ^9), so having both installed makes `npm install` hard-fail with an unresolvable peer
// conflict (yarn only warns, which is why this can go unnoticed until someone tries npm).
const eslintPluginImportConflict: Check = {
  id: 'eslint-plugin-import-conflict',
  description: 'eslint-plugin-import does not support eslint@10+',
  async run({ cwd }) {
    const pkg = await readPackageJson(cwd);
    if (!pkg) return [];
    const hasPluginImport = !!pkg.devDependencies?.['eslint-plugin-import'] || !!pkg.dependencies?.['eslint-plugin-import'];
    const eslintRange = pkg.devDependencies?.eslint ?? pkg.dependencies?.eslint;
    if (!hasPluginImport || !eslintRange) return [];

    const floor = minVersion(eslintRange);
    if (!floor || floor.major < 10) return [];

    return [
      {
        id: 'eslint-plugin-import-conflict',
        severity: 'error',
        file: 'package.json',
        message: `eslint-plugin-import is installed alongside eslint ${eslintRange} — no version of eslint-plugin-import supports eslint@10+, which makes \`npm install\` fail outright. Run with --fix to remove it (only worth keeping if you've migrated to eslint-plugin-import-x and actually use its rules).`,
        fix: async () => {
          const current = await readPackageJson(cwd);
          if (!current) return;
          const raw = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8')) as Record<string, unknown>;
          if (current.devDependencies?.['eslint-plugin-import']) {
            const devDeps = { ...current.devDependencies };
            delete devDeps['eslint-plugin-import'];
            raw.devDependencies = devDeps;
          }
          if (current.dependencies?.['eslint-plugin-import']) {
            const deps = { ...current.dependencies };
            delete deps['eslint-plugin-import'];
            raw.dependencies = deps;
          }
          await writePackageJson(cwd, raw);
        },
      },
    ];
  },
};

// Check 6: service-core's ACLRecord moved from boolean flags (create/read/update/delete/special/
// full) to `actions: ACLAction[]` before this CLI's templates were updated to match. `special` had
// no successor in the new format, so its presence in a @Protect(...) block is an unambiguous
// signal of the old shape (unlike e.g. `full`, every old-format record always carried `special`,
// and nothing in the new format could ever use that key name).
const oldAclFormat: Check = {
  id: 'old-acl-format',
  description: 'ACLRecord using the old boolean-flag shape instead of actions[]',
  async run({ cwd }) {
    const findings: Finding[] = [];
    const dirs = [join(cwd, 'src', 'models'), join(cwd, 'src', 'routes')];
    for (const dir of dirs) {
      let entries: string[];
      try {
        entries = (await readdir(dir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
      } catch {
        continue;
      }
      for (const entry of entries) {
        const filePath = join(dir, entry);
        const content = await readFile(filePath, 'utf-8');
        if (/@Protect\(/.test(content) && /\bspecial\s*:\s*(true|false)/.test(content)) {
          findings.push({
            id: 'old-acl-format',
            severity: 'warning',
            file: (dir.includes('models') ? join('src', 'models', entry) : join('src', 'routes', entry)).replace(/\\/g, '/'),
            message: `@Protect(...) in this file still uses the old boolean-flag ACLRecord shape (create/read/update/delete/special/full) — service-core now expects actions: ACLAction[]. Not auto-fixable (the mapping depends on which flags were true); see .claude/NOTES.md for the mapping used to migrate this CLI's own templates.`,
          });
        }
      }
    }
    return findings;
  },
};

// Check 7: JWTUser (from @rapidrest/core) is exactly { uid, roles, scopes, elevated? } — no
// `name` field. Passing one with an extra `name` property is a real tsc excess-property error,
// not just unused data.
const jwtUserExtraName: Check = {
  id: 'jwtuser-extra-name',
  description: 'JWTUtils.createToken(Sync) call whose user object includes a `name` field',
  async run({ cwd }) {
    const findings: Finding[] = [];
    const srcDir = join(cwd, 'src');

    async function walk(dir: string): Promise<string[]> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      const files: string[] = [];
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) files.push(...(await walk(full)));
        else if (e.name.endsWith('.ts')) files.push(full);
      }
      return files;
    }

    const files = await walk(srcDir);
    const callPattern = /JWTUtils\.createToken(?:Sync)?\(\s*[^,]+,\s*\{[^}]*\bname\s*:/;
    for (const file of files) {
      const content = await readFile(file, 'utf-8');
      if (callPattern.test(content)) {
        findings.push({
          id: 'jwtuser-extra-name',
          severity: 'warning',
          file: file.slice(cwd.length + 1).replace(/\\/g, '/'),
          message: 'JWTUtils.createToken(Sync)? is called with a `name` field on the user object — JWTUser has no such field (only uid/roles/scopes/elevated), so this is a real tsc excess-property error. Pass it via the third `data` argument instead.',
        });
      }
    }
    return findings;
  },
};

export const checks: Check[] = [
  wrongSqlTypeLiteral,
  missingSqliteHost,
  missingVitestConfig,
  missingTypesDependency('typeorm', TYPEORM_VERSION),
  missingTypesDependency('redis', REDIS_VERSION),
  eslintPluginImportConflict,
  oldAclFormat,
  jwtUserExtraName,
];

export async function runDoctor(ctx: CheckContext, selected: Check[] = checks): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const check of selected) {
    findings.push(...(await check.run(ctx)));
  }
  return findings;
}

// Re-checks are needed after --fix since a single check function returns findings computed from
// a point-in-time read — applying fixes can change what a subsequent check should report (e.g.
// fixing the sql-type-literal finding changes what missingSqliteHost sees). Kept intentionally
// simple: run once, apply every fixable finding, run again to get the final report and confirm
// resolution.
export async function applyFixes(findings: Finding[]): Promise<{ fixed: Finding[]; skipped: Finding[] }> {
  const fixed: Finding[] = [];
  const skipped: Finding[] = [];
  for (const finding of findings) {
    if (finding.fix) {
      await finding.fix();
      fixed.push(finding);
    } else {
      skipped.push(finding);
    }
  }
  return { fixed, skipped };
}
