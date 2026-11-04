///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { jsonMerge } from './patch.js';
import {
  detectApiRoute,
  detectPackageManager,
  detectReact,
  readProjectAuthor,
  readProjectDatastores,
  readProjectName,
  readProjectPackageJson,
  writeProjectPackageJson,
} from './project.js';
import { minVersion, satisfies, validRange } from 'semver';
import { renderTemplateFiles } from './template.js';
import { isResolvableRange, resolvePackageJsonRanges, type ResolveVersion } from './versionResolve.js';

export interface UpgradeContext {
  cwd: string;
  templatesDir: string;
  /** The templates' version, recorded as package.json `rapidrest.templates` when applied. */
  templatesVersion?: string;
  /** The running CLI's version, which the project's @rapidrest/cli devDependency is brought to. */
  cliVersion?: string;
  /** Resolves the templates' scaffold-time dependency ranges (see versionResolve.ts). */
  resolveVersion?: ResolveVersion;
}

export interface FileChange {
  relPath: string;
  templateDir: string;
  content: string;
}

export interface DependencyChange {
  section: 'dependencies' | 'devDependencies';
  name: string;
  from?: string;
  to: string;
}

export interface UpgradePlan {
  fileChanges: FileChange[];
  dependencyChanges: DependencyChange[];
  /** Set when package.json `rapidrest.templates` will change to the templates being applied. */
  templatesVersionChange?: { from?: string; to: string };
  /** The full merged package.json + its detected indent, present only when dependencyChanges is
   * non-empty. Not meant for direct inspection — applyUpgrade uses it to write the file back
   * without re-deriving it; --json output should report dependencyChanges instead. */
  packageJsonWrite?: { data: Record<string, unknown>; indent: string };
}

type DependencySection = Record<string, string>;
interface PackageJsonDeps {
  dependencies?: DependencySection;
  devDependencies?: DependencySection;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// The generator-owned boilerplate directories `upgrade` is allowed to refresh. `model`/`route`/
// `react` are deliberately excluded — every file those produce is user-owned; `default-route`'s
// files are generator-owned infra routes (Admin/Metrics/Status/etc.), never user business logic.
const SYNCABLE_TEMPLATE_DIRS = ['server', 'docker', 'helm', 'default-route'];

// Rendered from the same context as everything else, but never diffed/written even though it's a
// real output file under templates/server: src/config.ts's `datastores` block is only the base
// per-feature scaffold (acl/mongo/postgres/sqlite/cache/events) — `generate model` can insert
// additional named datastore blocks via a ts-block-insert patch (e.g. a custom "orders"
// datastore), and the file is hand-edited after generation (RBAC flags, connection details). A
// naive re-render from just features.* would silently drop anything beyond the base scaffold.
const EXCLUDED_RELPATHS = new Set(['src/config.ts', 'test/config.ts']);

async function buildContext(cwd: string, ctx?: UpgradeContext): Promise<Record<string, unknown>> {
  const [datastores, pkgManager, author, projectName, apiInfo, pkgFile] = await Promise.all([
    readProjectDatastores(cwd),
    detectPackageManager(cwd),
    readProjectAuthor(cwd),
    readProjectName(cwd),
    detectApiRoute(cwd),
    readProjectPackageJson(cwd),
  ]);

  const pkgData = pkgFile?.data as { description?: unknown; repository?: unknown } | undefined;
  const description = typeof pkgData?.description === 'string' ? pkgData.description : undefined;
  const repository = typeof pkgData?.repository === 'string' ? pkgData.repository : undefined;

  // config.ts stores TypeORM's own driver literals ("postgres"/"better-sqlite3"), not the CLI's
  // feature-flag names — same mapping generate/docker.ts and generate/k8s.ts already use.
  const hasMongoDB = datastores.some((ds) => ds.type === 'mongodb');
  const hasPostgres = datastores.some((ds) => ds.type === 'postgres');
  const hasSqlite = datastores.some((ds) => ds.type === 'better-sqlite3');
  const hasRedis = datastores.some((ds) => ds.type === 'redis');

  return {
    templatesVersion: ctx?.templatesVersion,
    cliVersion: ctx?.cliVersion,
    year: new Date().getFullYear(),
    author,
    description,
    repository,
    project_name: projectName,
    datastores,
    apiRoute: apiInfo.apiRoute,
    apiVersion: apiInfo.apiVersion,
    features: {
      mongodb: hasMongoDB,
      postgresql: hasPostgres,
      sqlite: hasSqlite,
      redis: hasRedis,
      hasDatabase: hasMongoDB || hasPostgres || hasSqlite,
      hasSqlDatastore: hasPostgres || hasSqlite,
    },
    hasMongoDB,
    hasPostgres,
    hasRedis,
    pkgMgr: {
      npm: pkgManager === 'npm',
      yarn: pkgManager === 'yarn',
    },
    // These flags only ever gate whether a file is considered at all (conditionalFiles in
    // template.config.json), never its content — forcing them true means the render never skips a
    // file that might already exist in the project. The "only touch files that already exist"
    // rule (see planFileChanges) is what keeps this safe: a project that never opted into e.g.
    // GitHub Actions or the AdminRoute simply doesn't have that file on disk, so it's untouched.
    scm: { git: true, github: true, gitlab: true },
    hasACLRoute: true,
    hasAdminRoute: true,
    hasMetricsRoute: true,
    hasOpenAPIRoute: true,
    hasPushRoute: true,
    hasStaticRoute: true,
    hasStatusRoute: true,
  };
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

async function planFileChanges(
  cwd: string,
  templatesDir: string,
  context: Record<string, unknown>,
): Promise<{ fileChanges: FileChange[]; serverPackageJson?: string }> {
  const fileChanges: FileChange[] = [];
  let serverPackageJson: string | undefined;

  for (const dir of SYNCABLE_TEMPLATE_DIRS) {
    let rendered;
    try {
      rendered = await renderTemplateFiles(join(templatesDir, dir), context);
    } catch {
      // Directory doesn't exist in this templatesDir (e.g. a stripped-down test fixture, or a
      // future template reorganization) — nothing to sync from it, not a fatal condition.
      continue;
    }
    for (const file of rendered) {
      if (dir === 'server' && file.relPath === 'package.json') {
        serverPackageJson = file.content;
        continue;
      }
      if (EXCLUDED_RELPATHS.has(file.relPath)) continue;

      const targetPath = join(cwd, file.relPath);
      if (!(await fileExists(targetPath))) continue;

      const current = await readFile(targetPath, 'utf-8');
      if (normalizeLineEndings(current) === normalizeLineEndings(file.content)) continue;

      fileChanges.push({ relPath: file.relPath, templateDir: dir, content: file.content });
    }
  }

  return { fileChanges, serverPackageJson };
}

async function readOptionalJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// Whether a dependency's current range already satisfies the template's: a scaffold-time range the
// resolver couldn't resolve (offline) stays as written (`^6`), and a project on `^6.1.0` is not
// "changed" to that looser range.
function alreadySatisfied(from: string | undefined, to: string): boolean {
  if (!from || !isResolvableRange(to) || !validRange(from)) return false;
  const floor = minVersion(from);
  return !!floor && satisfies(floor, to);
}

async function planDependencyChanges(
  cwd: string,
  templatesDir: string,
  serverPackageJson: string | undefined,
  resolveVersion?: ResolveVersion,
): Promise<{ dependencyChanges: DependencyChange[]; packageJsonWrite?: { data: Record<string, unknown>; indent: string } }> {
  if (!serverPackageJson) return { dependencyChanges: [] };

  const projectPkgFile = await readProjectPackageJson(cwd);
  if (!projectPkgFile) return { dependencyChanges: [] };

  let canonical = JSON.parse(serverPackageJson) as PackageJsonDeps & Record<string, unknown>;

  if (await detectReact(cwd)) {
    const reactPatch = await readOptionalJson(join(templatesDir, 'react', 'patches', 'package.json'));
    if (reactPatch) canonical = jsonMerge(canonical, reactPatch);
  }
  if (await fileExists(join(cwd, 'helm', 'Chart.yaml'))) {
    const helmPatch = await readOptionalJson(join(templatesDir, 'helm', 'patches', 'package.json'));
    if (helmPatch) canonical = jsonMerge(canonical, helmPatch);
  }

  if (resolveVersion) await resolvePackageJsonRanges(canonical, resolveVersion);

  const projectPkg = projectPkgFile.data as PackageJsonDeps;
  const dependencyChanges: DependencyChange[] = [];
  const toApply: PackageJsonDeps = { dependencies: {}, devDependencies: {} };
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const canonicalSection = canonical[section] ?? {};
    const projectSection = projectPkg[section] ?? {};
    for (const [name, to] of Object.entries(canonicalSection)) {
      const from = projectSection[name];
      if (from !== to && !alreadySatisfied(from, to)) {
        dependencyChanges.push({ section, name, from, to });
        toApply[section]![name] = to;
      }
    }
  }

  if (dependencyChanges.length === 0) return { dependencyChanges: [] };
  const updated = jsonMerge(projectPkgFile.data, toApply as Record<string, unknown>);

  return { dependencyChanges, packageJsonWrite: { data: updated, indent: projectPkgFile.indent } };
}

export async function planUpgrade(ctx: UpgradeContext): Promise<UpgradePlan> {
  const context = await buildContext(ctx.cwd, ctx);
  const { fileChanges, serverPackageJson } = await planFileChanges(ctx.cwd, ctx.templatesDir, context);
  let { dependencyChanges, packageJsonWrite } = await planDependencyChanges(
    ctx.cwd, ctx.templatesDir, serverPackageJson, ctx.resolveVersion);

  // Record the templates version applied, so later commands in the project keep to its major.
  let templatesVersionChange: UpgradePlan['templatesVersionChange'];
  const projectPkgFile = ctx.templatesVersion ? await readProjectPackageJson(ctx.cwd) : undefined;
  if (projectPkgFile && ctx.templatesVersion) {
    const recorded = (projectPkgFile.data.rapidrest as { templates?: unknown } | undefined)?.templates;
    if (recorded !== ctx.templatesVersion) {
      templatesVersionChange = { from: typeof recorded === 'string' ? recorded : undefined, to: ctx.templatesVersion };
      const base = packageJsonWrite ?? { data: projectPkgFile.data, indent: projectPkgFile.indent };
      packageJsonWrite = { ...base, data: jsonMerge(base.data, { rapidrest: { templates: ctx.templatesVersion } }) };
    }
  }

  return { fileChanges, dependencyChanges, templatesVersionChange, packageJsonWrite };
}

export async function applyUpgrade(ctx: UpgradeContext, plan: UpgradePlan): Promise<void> {
  for (const change of plan.fileChanges) {
    await writeFile(join(ctx.cwd, change.relPath), change.content, 'utf-8');
  }

  if (plan.packageJsonWrite) {
    await writeProjectPackageJson(ctx.cwd, plan.packageJsonWrite.data, plan.packageJsonWrite.indent);
  }
}
