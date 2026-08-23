///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { execFile } from 'child_process';
import { access, readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DatastoreInfo {
  name: string;
  type: string;
}

// Walks the characters inside `datastores: { ... }` and returns each datastore's name and type.
// Handles quoted strings and // line comments to avoid false matches in nested objects.
export function extractDatastoreInfo(source: string): DatastoreInfo[] {
  const idx = source.search(/\bdatastores\s*:\s*\{/);
  if (idx === -1) return [];

  const braceStart = source.indexOf('{', idx) + 1;
  let depth = 1;
  let i = braceStart;
  const result: DatastoreInfo[] = [];
  let currentName = '';
  let currentType = '';

  while (i < source.length && depth > 0) {
    // Skip line comments
    if (source[i] === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    // Skip string literals (single, double, template)
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
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
      if (depth === 1 && currentName) {
        result.push({ name: currentName, type: currentType });
        currentName = '';
        currentType = '';
      }
    } else if (depth === 1) {
      // Directly inside the datastores object — capture property names.
      const propMatch = source.slice(i).match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (propMatch) {
        currentName = propMatch[1];
        currentType = '';
        i += propMatch[1].length;
        continue;
      }
    } else if (depth === 2 && !currentType) {
      // Inside a datastore's value object — look for its `type:` field.
      const typeMatch = source.slice(i).match(/^type\s*:\s*['"`]([^'"`\n]+)['"`]/);
      if (typeMatch) {
        currentType = typeMatch[1];
        i += typeMatch[0].length;
        continue;
      }
    }
    i++;
  }

  return result;
}

export async function readProjectDatastores(cwd: string): Promise<DatastoreInfo[]> {
  try {
    const content = await readFile(join(cwd, 'src', 'config.ts'), 'utf-8');
    return extractDatastoreInfo(content);
  } catch {
    return [];
  }
}

export async function readProjectModels(cwd: string): Promise<string[]> {
  try {
    const entries = await readdir(join(cwd, 'src', 'models'));
    return entries
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

export function extractModelDatastore(source: string): string {
  return source.match(/@DataStore\(\s*["'`]([^"'`]+)["'`]\s*\)/)?.[1] ?? '';
}

export async function readModelDatastore(cwd: string, modelName: string): Promise<string> {
  try {
    const content = await readFile(join(cwd, 'src', 'models', `${modelName}.ts`), 'utf-8');
    return extractModelDatastore(content);
  } catch {
    return '';
  }
}

export interface ModelPropertyInfo {
  name: string;
  type: string;
}

// Finds the first field declared directly on a model class (e.g. `public name: string = "";`), skipping
// inherited base-entity properties (uid, version, dateCreated, etc.) since those live on BaseEntity/
// BaseMongoEntity and never appear as `public` declarations in the model's own source. Constructor body
// assignments (`this.name = ...`) never match since they lack the leading `public` keyword and `:` type
// annotation. Used to generate a realistic update-test target for route scaffolding.
export function extractFirstModelProperty(source: string): ModelPropertyInfo | undefined {
  const match = source.match(/^\s*public\s+(\w+)\??\s*:\s*([^=;]+?)\s*[=;]/m);
  if (!match) return undefined;
  return { name: match[1], type: match[2].trim() };
}

export async function readModelProperty(cwd: string, modelName: string): Promise<ModelPropertyInfo | undefined> {
  try {
    const content = await readFile(join(cwd, 'src', 'models', `${modelName}.ts`), 'utf-8');
    return extractFirstModelProperty(content);
  } catch {
    return undefined;
  }
}

// Produces a TypeScript literal (as source text) suitable for assigning to a model property of the given
// declared type in generated test code — used to exercise an update endpoint against a real, arbitrary
// property instead of assuming a hardcoded field. Falls back to a plain string cast to `any` for any type
// this can't confidently generate a literal for (enums, unions, arrays, custom classes, etc.).
export function formatExamplePropertyValue(type: string): string {
  // Array/generic types (`string[]`, `Array<string>`) fall through to the `any` cast — a bare scalar
  // literal isn't assignable to them even though the word `string`/`number`/etc. appears in the type text.
  if (/\[\]|<.*>/.test(type)) return '"updated" as any';
  if (/\bstring\b/.test(type)) return '"updated"';
  if (/\bnumber\b/.test(type)) return '42';
  if (/\bboolean\b/.test(type)) return 'true';
  return '"updated" as any';
}

export async function detectReact(cwd: string): Promise<boolean> {
  try {
    await access(join(cwd, 'vite.config.ts'));
    return true;
  } catch {
    return false;
  }
}

export interface ExistingReactApp {
  /** Path to the route file, relative to cwd (e.g. "src/routes/AppRoute.ts"). */
  routeFile: string;
  className: string;
  /** appDir exactly as written in the route class's source. */
  appDir: string;
  /** The @Route(...) mount path. */
  routePath: string;
}

// Scans src/routes/*.ts for ReactRoute subclasses generated by `generate react`, extracting each
// one's appDir and @Route mount path. Used to detect an existing single-app layout (an appDir
// not yet under apps/) that needs migrating when a second app is added, and to enumerate every
// app's appDir when regenerating vite.config.ts.
export async function findExistingReactApps(cwd: string): Promise<ExistingReactApp[]> {
  const routesDir = join(cwd, 'src', 'routes');
  let files: string[];
  try {
    files = (await readdir(routesDir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
  } catch {
    return [];
  }

  const apps: ExistingReactApp[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(routesDir, file), 'utf-8');
    } catch {
      continue;
    }
    const classMatch = content.match(/class\s+(\w+)\s+extends\s+ReactRoute\b/);
    const appDirMatch = content.match(/appDir\s*:\s*string\s*=\s*["'`]([^"'`]+)["'`]/);
    if (!classMatch || !appDirMatch) continue;
    const routeMatch = content.match(/@Route\(\s*["'`]([^"'`]*)["'`]\s*\)/);
    apps.push({
      routeFile: join('src', 'routes', file).replace(/\\/g, '/'),
      className: classMatch[1],
      appDir: appDirMatch[1],
      routePath: routeMatch?.[1] ?? '',
    });
  }
  return apps;
}

export async function readProjectName(cwd: string): Promise<string> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { name?: string };
    return pkg.name ?? '';
  } catch {
    return '';
  }
}

// Reads `user.name` and `user.email` from the global git configuration and combines
// them as "Name <email>". Returns undefined if git is unavailable or user.name is unset.
export async function detectPackageManager(cwd: string): Promise<'npm' | 'yarn'> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { packageManager?: string };
    if (pkg.packageManager?.startsWith('yarn')) return 'yarn';
  } catch { /* ignore */ }
  try {
    await access(join(cwd, 'yarn.lock'));
    return 'yarn';
  } catch { /* ignore */ }
  return 'npm';
}

export async function readGitAuthor(): Promise<string | undefined> {
  try {
    const { stdout: nameOut } = await execFileAsync('git', ['config', 'user.name']);
    const name = nameOut.trim();
    if (!name) return undefined;
    try {
      const { stdout: emailOut } = await execFileAsync('git', ['config', 'user.email']);
      const email = emailOut.trim();
      return email ? `${name} <${email}>` : name;
    } catch {
      return name;
    }
  } catch {
    return undefined;
  }
}

// Reads the `author` field from the project's package.json in the given directory.
// Handles both string and { name, email } object forms. Returns undefined on any failure.
export async function readProjectAuthor(cwd: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { author?: string | { name?: string } };
    if (typeof pkg.author === 'string') return pkg.author || undefined;
    if (typeof pkg.author === 'object' && pkg.author !== null) return pkg.author.name || undefined;
  } catch { /* no package.json or parse error */ }
  return undefined;
}

export interface ProjectPackageJson {
  data: Record<string, unknown>;
  indent: string;
}

// Detects the indentation unit used by the file's first indented line (e.g. "\t" for the
// tab-indented package.json the server template ships). Anything writing package.json back out
// should reuse this rather than a hardcoded 2-space indent, or every write silently reformats the
// whole file.
function detectIndent(raw: string): string {
  const match = raw.match(/^[ \t]+/m);
  return match ? match[0] : '  ';
}

export async function readProjectPackageJson(cwd: string): Promise<ProjectPackageJson | undefined> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    return { data: JSON.parse(raw) as Record<string, unknown>, indent: detectIndent(raw) };
  } catch {
    return undefined;
  }
}

export async function writeProjectPackageJson(cwd: string, data: Record<string, unknown>, indent: string): Promise<void> {
  await writeFile(join(cwd, 'package.json'), JSON.stringify(data, null, indent) + '\n', 'utf-8');
}
