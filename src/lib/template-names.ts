///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////

// npm treats a handful of dotfiles specially when packing: `.gitignore` is never published, and
// `.npmignore`/`.gitignore` files nested inside a published directory act as ignore rules for the
// *CLI package itself* (stripping e.g. templates/server/src), while `.npmrc` is always dropped.
// Templates therefore store these files under a neutral `_` prefix (`_gitignore`, `_npmignore`,
// `_npmrc`) and the generator renames them to the real dotted name when writing a project.
// This module is the single source of truth for that mapping.

/** Base names (without the leading dot) that npm packaging treats specially. */
export const NPM_SPECIAL_DOTFILES = ['gitignore', 'npmignore', 'npmrc'] as const;

const TO_OUTPUT = new Map<string, string>(NPM_SPECIAL_DOTFILES.map((n) => [`_${n}`, `.${n}`]));
const TO_TEMPLATE = new Map<string, string>(NPM_SPECIAL_DOTFILES.map((n) => [`.${n}`, `_${n}`]));

function mapBaseName(relPath: string, table: Map<string, string>): string {
  const normalized = relPath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/');
  const dir = normalized.slice(0, idx + 1);
  const base = normalized.slice(idx + 1);
  return dir + (table.get(base) ?? base);
}

/** Maps a path as stored in `templates/` to the name it takes in a generated project
 * (`src/_gitignore` -> `src/.gitignore`). Paths with no special base name are returned unchanged
 * (apart from separator normalisation to `/`). */
export function toOutputPath(templateRelPath: string): string {
  return mapBaseName(templateRelPath, TO_OUTPUT);
}

/** Inverse of {@link toOutputPath}: maps a generated project's path back to the name used inside
 * `templates/` (`.gitignore` -> `_gitignore`). */
export function toTemplatePath(outputRelPath: string): string {
  return mapBaseName(outputRelPath, TO_TEMPLATE);
}
