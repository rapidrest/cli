///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { type Command, Flags } from '@oclif/core';
import { processTemplate } from './template.js';
import { resolveTemplates, type ResolvedTemplates, type TemplatesMode } from './templateSource.js';
import { createVersionResolver } from './versionResolve.js';

/** The --templates flag every command that renders templates takes. */
export const templatesFlag = Flags.string({
  description: 'Templates to use: a templates release version (e.g. 1.2.0), or a local templates directory or .zip. ' +
    'Defaults to the newest compatible release (env: RAPIDREST_TEMPLATES).',
});

/**
 * Resolves the templates a command renders (see templateSource.ts), reporting a failure as the
 * command's error. `mode` is `new` for a new project, `project` inside an existing one.
 */
export async function useTemplates(
  command: Command,
  cwd: string,
  mode: TemplatesMode,
  override: string | undefined,
): Promise<ResolvedTemplates> {
  try {
    return await resolveTemplates({
      cliRoot: command.config.root,
      cwd,
      mode,
      override: override || process.env.RAPIDREST_TEMPLATES || undefined,
      log: (m) => command.log(m),
      warn: (m) => command.warn(m),
    });
  } catch (e) {
    command.error(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Renders one template into the project the way every generator does: processTemplate() with
 * scaffold-time dependency ranges resolved against the npm registry (see versionResolve.ts).
 */
export async function renderTemplate(
  command: Command,
  templateDir: string,
  outputDir: string,
  context: Record<string, unknown>,
  opts: { force?: boolean; projectDir?: string },
): Promise<void> {
  const versions = createVersionResolver((m) => command.warn(m));
  try {
    await processTemplate(templateDir, outputDir, context, { ...opts, resolveVersion: versions.resolve });
  } finally {
    await versions.close();
  }
}
