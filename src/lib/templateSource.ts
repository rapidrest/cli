///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { createHash, randomBytes } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { dirname, isAbsolute, join, resolve, sep } from 'path';
import { pipeline } from 'stream/promises';
import { major, minVersion, prerelease, rcompare, satisfies, valid, validRange } from 'semver';
import { Agent, interceptors, request, type Dispatcher } from 'undici';
import yauzl from 'yauzl';

// The templates are released separately from the CLI, as GitHub releases of this repository tagged
// `templates-v<version>`, each carrying a zip of the templates/ tree and a copy of its manifest
// (templates/templates.json plus the zip's SHA-256). The CLI picks the newest release it can use and
// caches it under ~/.rapidrest/templates/<version>/.
//
// Compatibility has two parts:
// - engine: what the templates need from the CLI that renders them (the template.config.json
//   schema, patch strategies, Handlebars helpers, the context each generator passes, the `_` dotfile
//   names, scaffold-time version ranges). The manifest's `engine` range must include
//   TEMPLATE_ENGINE_VERSION. Bump that version's minor for an additive engine change and its major for
//   a breaking one.
// - targets: the @rapidrest framework majors the generated code is written for. Inside an existing
//   project, only templates whose targets match the project's installed packages are used, and never
//   a different templates major than the one the project was scaffolded with (package.json
//   `rapidrest.templates`), so a project only ever receives compatible fixes. `upgrade --latest` is the
//   explicit way across.

// 1.1: upgrade leaves .claude/settings.json alone, so templates that ship one need at least 1.1.
/** The template engine contract this CLI implements. */
export const TEMPLATE_ENGINE_VERSION = '1.1.0';
export const TEMPLATES_REPO = 'rapidrest/cli';
export const TEMPLATES_TAG_PREFIX = 'templates-v';
export const TEMPLATES_ZIP_ASSET = 'rapidrest-templates.zip';
export const TEMPLATES_MANIFEST_ASSET = 'templates.json';
export const TEMPLATES_MANIFEST_FILE = 'templates.json';
const RELEASES_CACHE_FILE = 'releases.json';
const RELEASES_CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_RELEASE_PAGES = 5;

export interface TemplatesManifest {
  version: string;
  /** Range of TEMPLATE_ENGINE_VERSION these templates work with. */
  engine: string;
  /** @rapidrest package name -> range of versions the generated code targets. */
  targets?: Record<string, string>;
  /** SHA-256 (hex) of the release zip. Present in a release's manifest asset only. */
  sha256?: string;
}

export interface ResolvedTemplates {
  /** Directory holding every template (server/, route/, ...). */
  dir: string;
  version: string;
  source: 'override' | 'checkout' | 'release' | 'cache';
}

// - `new`: scaffolding a new project; the newest templates this CLI can render.
// - `project`: working inside an existing project; also limited to the project's framework majors and
//   templates major.
// - `latest`: like `new`, for an existing project that is deliberately moving to newer templates.
export type TemplatesMode = 'new' | 'project' | 'latest';

export interface ProjectConstraints {
  /** Installed (or, without node_modules, minimum declared) version of each @rapidrest package. */
  installed: Record<string, string>;
  /** Templates version recorded in package.json when the project was scaffolded or last upgraded. */
  recorded?: string;
}

export interface ReleaseAsset {
  name: string;
  url: string;
  /** `sha256:<hex>`, when GitHub reports one. */
  digest?: string;
}

export interface TemplatesRelease {
  version: string;
  tag: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
}

/** Network access, injectable for tests. */
export interface TemplatesHttp {
  getJson(url: string, headers: Record<string, string>): Promise<unknown>;
  download(url: string, destination: string, headers: Record<string, string>): Promise<void>;
  close(): Promise<void>;
}

export interface ResolveTemplatesOptions {
  /** The CLI's install root (oclif `config.root`); a source checkout's templates/ is used directly. */
  cliRoot: string;
  /** The project directory (for `project` mode). */
  cwd: string;
  mode: TemplatesMode;
  /** A templates version, or a local templates directory or .zip (the --templates flag / RAPIDREST_TEMPLATES). */
  override?: string;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  /** Defaults to ~/.rapidrest/templates (or $RAPIDREST_HOME/templates). */
  cacheRoot?: string;
  http?: TemplatesHttp;
  now?: () => number;
}

export function templatesCacheRoot(): string {
  return join(process.env.RAPIDREST_HOME || join(homedir(), '.rapidrest'), 'templates');
}

function noop(): void {
  // Default for an omitted log/warn callback.
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T;
  } catch {
    return undefined;
  }
}

export async function readTemplatesManifest(dir: string): Promise<TemplatesManifest | undefined> {
  const manifest = await readJsonFile<TemplatesManifest>(join(dir, TEMPLATES_MANIFEST_FILE));
  return manifest && valid(manifest.version) && validRange(manifest.engine) ? manifest : undefined;
}

/** Reads what an existing project constrains its templates to. Empty outside a RapidREST project. */
export async function readProjectConstraints(cwd: string): Promise<ProjectConstraints> {
  const pkg = await readJsonFile<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    rapidrest?: { templates?: unknown };
  }>(join(cwd, 'package.json'));
  const installed: Record<string, string> = {};
  const declared = { ...pkg?.devDependencies, ...pkg?.dependencies };
  for (const [name, range] of Object.entries(declared)) {
    if (!name.startsWith('@rapidrest/') || name === '@rapidrest/cli') continue;
    const fromModules = await readJsonFile<{ version?: string }>(join(cwd, 'node_modules', name, 'package.json'));
    const version = valid(fromModules?.version) ?? (validRange(range) ? minVersion(range)?.version : undefined);
    if (version) installed[name] = version;
  }
  const recorded = typeof pkg?.rapidrest?.templates === 'string' ? valid(pkg.rapidrest.templates) ?? undefined : undefined;
  return { installed, recorded };
}

/** Returns why the templates can't be used, or undefined when they can. */
export function incompatibility(
  manifest: TemplatesManifest,
  mode: TemplatesMode,
  project?: ProjectConstraints,
): string | undefined {
  if (!satisfies(TEMPLATE_ENGINE_VERSION, manifest.engine)) {
    return `needs template engine ${manifest.engine}, and this CLI provides ${TEMPLATE_ENGINE_VERSION} (update the CLI)`;
  }
  if (mode !== 'project' || !project) return undefined;
  if (project.recorded && major(project.recorded) !== major(manifest.version)) {
    return `the project uses templates ${major(project.recorded)}.x (run \`rapidrest upgrade --latest\` to move to a newer major)`;
  }
  for (const [name, range] of Object.entries(manifest.targets ?? {})) {
    const installed = project.installed[name];
    if (installed && !satisfies(installed, range)) {
      return `they target ${name} ${range} and the project has ${installed}`;
    }
  }
  return undefined;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'rapidrest-cli',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

const DOWNLOAD_HEADERS = { 'User-Agent': 'rapidrest-cli', Accept: 'application/octet-stream' };

interface GitHubRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string; digest?: string | null }[];
}

function toTemplatesRelease(release: GitHubRelease): TemplatesRelease | undefined {
  const tag = release.tag_name ?? '';
  if (release.draft || !tag.startsWith(TEMPLATES_TAG_PREFIX)) return undefined;
  const version = valid(tag.slice(TEMPLATES_TAG_PREFIX.length));
  if (!version) return undefined;
  const assets = (release.assets ?? [])
    .filter((a) => a.name && a.browser_download_url)
    .map((a) => ({ name: a.name!, url: a.browser_download_url!, ...(a.digest ? { digest: a.digest } : {}) }));
  return { version, tag, prerelease: !!release.prerelease || !!prerelease(version), assets };
}

// Lists the templates releases, newest first. The list is cached for an hour (GitHub allows 60
// unauthenticated API requests an hour; set GITHUB_TOKEN to raise that); a stale list is used when
// GitHub can't be reached.
async function listReleases(http: TemplatesHttp, cacheRoot: string, now: number, warn: (m: string) => void): Promise<TemplatesRelease[]> {
  const cachePath = join(cacheRoot, RELEASES_CACHE_FILE);
  const cached = await readJsonFile<{ fetchedAt: number; releases: TemplatesRelease[] }>(cachePath);
  if (cached && now - cached.fetchedAt < RELEASES_CACHE_TTL_MS) return cached.releases;

  try {
    const releases: TemplatesRelease[] = [];
    for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
      const batch = await http.getJson(
        `https://api.github.com/repos/${TEMPLATES_REPO}/releases?per_page=100&page=${page}`,
        githubHeaders(),
      ) as GitHubRelease[];
      if (!Array.isArray(batch)) throw new Error('unexpected response from the GitHub releases API');
      for (const r of batch) {
        const release = toTemplatesRelease(r);
        if (release) releases.push(release);
      }
      if (batch.length < 100) break;
    }
    releases.sort((a, b) => rcompare(a.version, b.version));
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(cachePath, JSON.stringify({ fetchedAt: now, releases }), 'utf-8');
    return releases;
  } catch (e) {
    if (cached) {
      warn(`Could not list templates releases on GitHub (${message(e)}); using the list from ${new Date(cached.fetchedAt).toISOString()}.`);
      return cached.releases;
    }
    throw e;
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function asset(release: TemplatesRelease, name: string): ReleaseAsset {
  const found = release.assets.find((a) => a.name === name);
  if (!found) throw new Error(`templates release ${release.version} has no ${name} asset`);
  return found;
}

// A release's manifest never changes, so it is cached for good once read.
async function releaseManifest(http: TemplatesHttp, cacheRoot: string, release: TemplatesRelease): Promise<TemplatesManifest> {
  const cachePath = join(cacheRoot, 'manifests', `${release.version}.json`);
  const cached = await readJsonFile<TemplatesManifest>(cachePath);
  if (cached) return cached;
  const tmp = join(cacheRoot, `.tmp-${randomBytes(6).toString('hex')}.json`);
  await mkdir(cacheRoot, { recursive: true });
  try {
    await http.download(asset(release, TEMPLATES_MANIFEST_ASSET).url, tmp, DOWNLOAD_HEADERS);
    const manifest = await readJsonFile<TemplatesManifest>(tmp);
    if (!manifest || manifest.version !== release.version || !validRange(manifest.engine) || !manifest.sha256) {
      throw new Error(`templates release ${release.version} has an invalid ${TEMPLATES_MANIFEST_ASSET}`);
    }
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(manifest), 'utf-8');
    return manifest;
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

// The parts of yauzl used here (it ships no types; see src/types/yauzl.d.ts).
interface ZipEntry { fileName: string }
interface ZipFile {
  on(event: 'entry', listener: (entry: ZipEntry) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  readEntry(): void;
  openReadStream(entry: ZipEntry, callback: (err: Error | null, stream?: NodeJS.ReadableStream) => void): void;
  close(): void;
}

/** Extracts a zip into `destination`, refusing any entry that would land outside it. */
export async function extractZip(zipPath: string, destination: string): Promise<void> {
  const root = resolve(destination);
  const zip = await new Promise<ZipFile>((res, rej) =>
    yauzl.open(zipPath, { lazyEntries: true }, (err: Error | null, z: ZipFile) => (err ? rej(err) : res(z))));
  try {
    await new Promise<void>((res, rej) => {
      zip.on('error', rej);
      zip.on('end', () => res());
      zip.on('entry', (entry: ZipEntry) => {
        const name = entry.fileName.replace(/\\/g, '/');
        const target = resolve(root, name);
        if (isAbsolute(name) || (target !== root && !target.startsWith(root + sep))) {
          rej(new Error(`refusing zip entry outside the extraction directory: ${entry.fileName}`));
          return;
        }
        if (name.endsWith('/')) {
          mkdir(target, { recursive: true }).then(() => zip.readEntry(), rej);
          return;
        }
        zip.openReadStream(entry, (err: Error | null, stream?: NodeJS.ReadableStream) => {
          if (err || !stream) {
            rej(err ?? new Error(`could not read ${entry.fileName}`));
            return;
          }
          mkdir(dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => zip.readEntry(), rej);
        });
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

// Installs a zip of templates as cacheRoot/<name>, atomically: extracted beside it and renamed into
// place, so a concurrent or interrupted run never leaves a half-written copy that looks complete.
async function installZip(zipPath: string, cacheRoot: string, name: string): Promise<string> {
  const target = join(cacheRoot, name);
  const tmp = join(cacheRoot, `.tmp-${randomBytes(6).toString('hex')}`);
  try {
    await extractZip(zipPath, tmp);
    if (!(await readTemplatesManifest(tmp))) throw new Error(`the zip has no valid ${TEMPLATES_MANIFEST_FILE}`);
    try {
      await rename(tmp, target);
    } catch (e) {
      if (!(await readTemplatesManifest(target))) throw e; // another run installed it first otherwise
    }
    return target;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function ensureRelease(
  http: TemplatesHttp,
  cacheRoot: string,
  release: TemplatesRelease,
  manifest: TemplatesManifest,
  log: (m: string) => void,
): Promise<string> {
  const dir = join(cacheRoot, release.version);
  if (await readTemplatesManifest(dir)) return dir;

  log(`Downloading RapidREST templates ${release.version}...`);
  const zipAsset = asset(release, TEMPLATES_ZIP_ASSET);
  const zipPath = join(cacheRoot, `.tmp-${randomBytes(6).toString('hex')}.zip`);
  await mkdir(cacheRoot, { recursive: true });
  try {
    await http.download(zipAsset.url, zipPath, DOWNLOAD_HEADERS);
    const actual = await sha256File(zipPath);
    const expected = [manifest.sha256, zipAsset.digest?.replace(/^sha256:/, '')].filter(Boolean);
    if (expected.some((sha) => sha!.toLowerCase() !== actual)) {
      throw new Error(`templates ${release.version} failed verification: the download's SHA-256 is ${actual}, expected ${expected.join(' / ')}`);
    }
    return await installZip(zipPath, cacheRoot, release.version);
  } finally {
    await rm(zipPath, { force: true });
  }
}

async function cachedVersions(cacheRoot: string): Promise<{ dir: string; manifest: TemplatesManifest }[]> {
  let names: string[];
  try {
    names = await readdir(cacheRoot);
  } catch {
    return [];
  }
  const found: { dir: string; manifest: TemplatesManifest }[] = [];
  for (const name of names.filter((n) => valid(n))) {
    const manifest = await readTemplatesManifest(join(cacheRoot, name));
    if (manifest) found.push({ dir: join(cacheRoot, name), manifest });
  }
  return found.sort((a, b) => rcompare(a.manifest.version, b.manifest.version));
}

async function resolveOverride(
  override: string,
  opts: ResolveTemplatesOptions,
  http: TemplatesHttp,
  cacheRoot: string,
  now: number,
  project: ProjectConstraints | undefined,
): Promise<ResolvedTemplates> {
  const log = opts.log ?? noop;
  const warn = opts.warn ?? noop;
  const local = resolve(opts.cwd, override);
  let dir: string | undefined;
  let manifest: TemplatesManifest | undefined;

  if (await exists(local)) {
    if (local.toLowerCase().endsWith('.zip')) {
      const name = `local-${(await sha256File(local)).slice(0, 16)}`;
      dir = join(cacheRoot, name);
      if (!(await readTemplatesManifest(dir))) {
        await mkdir(cacheRoot, { recursive: true });
        await installZip(local, cacheRoot, name);
      }
    } else {
      dir = local;
    }
    manifest = await readTemplatesManifest(dir);
    if (!manifest) throw new Error(`${override} has no valid ${TEMPLATES_MANIFEST_FILE}, so it isn't a templates directory.`);
  } else if (valid(override)) {
    const version = valid(override)!;
    const release = (await listReleases(http, cacheRoot, now, warn)).find((r) => r.version === version);
    if (!release) throw new Error(`There is no templates release ${version} (tag ${TEMPLATES_TAG_PREFIX}${version}).`);
    manifest = await releaseManifest(http, cacheRoot, release);
    const reason = incompatibility(manifest, 'new');
    if (reason) throw new Error(`Templates ${version} can't be used: ${reason}.`);
    dir = await ensureRelease(http, cacheRoot, release, manifest, log);
  } else {
    throw new Error(`--templates "${override}" is neither a templates version nor an existing directory or .zip.`);
  }

  const engineReason = incompatibility(manifest, 'new');
  if (engineReason) throw new Error(`Templates ${manifest.version} can't be used: ${engineReason}.`);
  const projectReason = incompatibility(manifest, opts.mode, project);
  if (projectReason) warn(`Using templates ${manifest.version} as requested, although ${projectReason}.`);
  return { dir, version: manifest.version, source: 'override' };
}

/** Finds (downloading if need be) the templates to use. */
export async function resolveTemplates(opts: ResolveTemplatesOptions): Promise<ResolvedTemplates> {
  const cacheRoot = opts.cacheRoot ?? templatesCacheRoot();
  const now = (opts.now ?? Date.now)();
  const log = opts.log ?? noop;
  const warn = opts.warn ?? noop;
  const project = opts.mode === 'project' ? await readProjectConstraints(opts.cwd) : undefined;
  const http = opts.http ?? createTemplatesHttp();

  try {
    if (opts.override) return await resolveOverride(opts.override, opts, http, cacheRoot, now, project);

    // A source checkout of the CLI renders its own templates/, so template changes can be tried
    // before they're released. The published CLI doesn't include templates/.
    const checkout = join(opts.cliRoot, 'templates');
    const checkoutManifest = await readTemplatesManifest(checkout);
    if (checkoutManifest) return { dir: checkout, version: checkoutManifest.version, source: 'checkout' };

    let releases: TemplatesRelease[];
    try {
      releases = await listReleases(http, cacheRoot, now, warn);
    } catch (e) {
      const usable = (await cachedVersions(cacheRoot)).find((c) => !incompatibility(c.manifest, opts.mode, project));
      if (!usable) {
        throw new Error(`Could not download the RapidREST templates (${message(e)}), and no usable copy is cached. ` +
          'Check your connection (or set GITHUB_TOKEN if GitHub is rate limiting you), or pass --templates <directory|zip>.');
      }
      warn(`Could not reach GitHub (${message(e)}); using cached templates ${usable.manifest.version}.`);
      return { dir: usable.dir, version: usable.manifest.version, source: 'cache' };
    }

    const reasons: string[] = [];
    for (const release of releases.filter((r) => !r.prerelease)) {
      const manifest = await releaseManifest(http, cacheRoot, release);
      const reason = incompatibility(manifest, opts.mode, project);
      if (reason) {
        reasons.push(`${release.version}: ${reason}`);
        continue;
      }
      return { dir: await ensureRelease(http, cacheRoot, release, manifest, log), version: release.version, source: 'release' };
    }
    throw new Error(reasons.length === 0
      ? `No RapidREST templates release was found on GitHub (${TEMPLATES_REPO}, tags ${TEMPLATES_TAG_PREFIX}*). Pass --templates <directory|zip> to use local templates.`
      : `None of the RapidREST templates releases can be used here:\n  ${reasons.slice(0, 5).join('\n  ')}`);
  } finally {
    if (!opts.http) await http.close();
  }
}

/** The default network client: undici with redirects followed (release downloads redirect to a CDN). */
export function createTemplatesHttp(): TemplatesHttp {
  let agent: Dispatcher | undefined;
  let base: Agent | undefined;
  const dispatcher = (): Dispatcher => {
    if (!agent) {
      // A short-lived Agent closed when done: see fetchLatestVersion() in depUpgrade.ts for why
      // this avoids the global fetch().
      base = new Agent({ keepAliveTimeout: 1, keepAliveMaxTimeout: 1 });
      agent = base.compose(interceptors.redirect({ maxRedirections: 5 }));
    }
    return agent;
  };
  const get = async (url: string, headers: Record<string, string>): Promise<Dispatcher.ResponseData> => {
    const res = await request(url, { headers, dispatcher: dispatcher() });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      await res.body.dump();
      const limited = res.statusCode === 403 || res.statusCode === 429;
      throw new Error(`HTTP ${res.statusCode} from ${new URL(url).host}${limited ? ' (rate limited? set GITHUB_TOKEN)' : ''}`);
    }
    return res;
  };
  return {
    getJson: async (url, headers) => (await get(url, headers)).body.json(),
    download: async (url, destination, headers) => {
      const res = await get(url, headers);
      await pipeline(res.body, createWriteStream(destination));
    },
    close: async () => {
      await base?.close();
      base = undefined;
      agent = undefined;
    },
  };
}
