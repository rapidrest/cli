import { access, readFile, readdir } from 'fs/promises';
import { join } from 'path';

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

export async function detectReact(cwd: string): Promise<boolean> {
  try {
    await access(join(cwd, 'vite.config.ts'));
    return true;
  } catch {
    return false;
  }
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
