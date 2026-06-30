import Handlebars from 'handlebars';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export interface PatchEntry {
  template: string;
  target: string;
  strategy: 'ts-block-insert' | 'json-merge';
  insertInto?: string;
  idempotencyKey?: string;
  condition?: string;
}

function resolveContextValue(path: string, context: Record<string, unknown>): unknown {
  return path.split('.').reduce((obj: unknown, key: string) => {
    if (obj !== null && typeof obj === 'object') {
      return (obj as Record<string, unknown>)[key];
    }
    return undefined;
  }, context as unknown);
}

function resolveCondition(condition: string, context: Record<string, unknown>): boolean {
  return Boolean(resolveContextValue(condition, context));
}

// Inserts `snippet` into the named block (e.g. `datastores: { … }`) in `source`.
// Uses the same character-walker as extractDatastoreInfo to skip strings and // comments.
// Returns source unchanged when `idempotencyKey` is already present as a depth-1 property.
// Throws if the block cannot be found or its closing brace is malformed.
export function tsBlockInsert(
  source: string,
  blockName: string,
  snippet: string,
  idempotencyKey: string,
): string {
  const blockPattern = new RegExp(`\\b${blockName}\\s*:\\s*\\{`);
  const match = source.match(blockPattern);
  if (!match || match.index === undefined) {
    throw new Error(`Could not find '${blockName}' block in source`);
  }

  let i = match.index + match[0].length; // first char after opening {
  let depth = 1;
  let blockEnd = -1;

  while (i < source.length && depth > 0) {
    // Skip // line comments
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
      if (depth === 0) {
        blockEnd = i;
        break;
      }
    } else if (depth === 1 && idempotencyKey) {
      // At depth 1, check for an already-present property with this name
      const propMatch = source.slice(i).match(/^([A-Za-z_$][\w$]*)\s*:/);
      if (propMatch && propMatch[1] === idempotencyKey) {
        return source; // already patched — no-op
      }
    }
    i++;
  }

  if (blockEnd === -1) {
    throw new Error(`Malformed '${blockName}' block: no matching closing brace`);
  }

  return source.slice(0, blockEnd) + snippet + source.slice(blockEnd);
}

// Recursively merges `patch` into a shallow copy of `target`.
// Plain objects at the same key recurse; arrays and scalars — patch value wins.
// Does not mutate either argument.
export function jsonMerge(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(patch)) {
    const pv = patch[key];
    const tv = result[key];
    if (
      pv !== null &&
      typeof pv === 'object' &&
      !Array.isArray(pv) &&
      tv !== null &&
      typeof tv === 'object' &&
      !Array.isArray(tv)
    ) {
      result[key] = jsonMerge(tv as Record<string, unknown>, pv as Record<string, unknown>);
    } else {
      result[key] = pv;
    }
  }
  return result;
}

export async function applyPatches(
  templateDir: string,
  projectDir: string,
  context: Record<string, unknown>,
  patches: PatchEntry[],
): Promise<void> {
  for (const entry of patches) {
    if (entry.condition && !resolveCondition(entry.condition, context)) continue;

    const patchTemplatePath = join(templateDir, entry.template);
    const rawPatch = await readFile(patchTemplatePath, 'utf-8');
    // Escape ${{ to avoid Handlebars treating GitHub Actions syntax as templates
    const escaped = rawPatch.replace(/\$\{\{/g, '$\\{{');
    const renderedPatch = Handlebars.compile(escaped, { noEscape: true })(context);

    const targetPath = join(projectDir, entry.target);

    if (entry.strategy === 'ts-block-insert') {
      let targetSource: string;
      try {
        targetSource = await readFile(targetPath, 'utf-8');
      } catch {
        throw new Error(`Patch target file not found: ${targetPath}`);
      }
      const idempotencyKey = entry.idempotencyKey
        ? Handlebars.compile(entry.idempotencyKey, { noEscape: true })(context)
        : '';
      const updated = tsBlockInsert(targetSource, entry.insertInto!, renderedPatch, idempotencyKey);
      await writeFile(targetPath, updated, 'utf-8');

    } else if (entry.strategy === 'json-merge') {
      let existingJson: Record<string, unknown> = {};
      try {
        const raw = await readFile(targetPath, 'utf-8');
        existingJson = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // File doesn't exist — treat as empty; patch becomes the initial content
      }
      const patchJson = JSON.parse(renderedPatch) as Record<string, unknown>;
      const merged = jsonMerge(existingJson, patchJson);
      await writeFile(targetPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    }
  }
}
