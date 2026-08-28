///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { confirm, input } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { findExistingReactApps, installIfPackageJsonChanged, readPackageJsonRaw, readProjectName, type ExistingReactApp } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';

/**
 * Converts the first character of the given string to uppercase
 */
function toPascalCase(name: string): string {
  return `${name.substring(0,1).toUpperCase()}${name.substring(1)}`;
}

// Moves an existing single-app layout (an appDir not yet under apps/) to apps/<name>/, and
// rewrites that route class's appDir field to match. Lets a project's first React app go
// straight from a plain app/ directory to a namespaced one the moment a second app is added,
// instead of requiring the manual restructuring auth-server needed before multi-app support
// existed in @rapidrest/react.
async function migrateToNamespacedAppDir(cwd: string, app: ExistingReactApp, log: (msg: string) => void): Promise<void> {
  const newAppDir = join('apps', basename(app.appDir)).replace(/\\/g, '/');
  log(`Migrating existing app: ${app.appDir}/ -> ${newAppDir}/`);

  await mkdir(join(cwd, 'apps'), { recursive: true });
  await rename(join(cwd, app.appDir), join(cwd, newAppDir));

  const routeFilePath = join(cwd, app.routeFile);
  const source = await readFile(routeFilePath, 'utf-8');
  const updated = source.replace(
    /(appDir\s*:\s*string\s*=\s*["'`])[^"'`]+(["'`])/,
    `$1${newAppDir}$2`,
  );
  await writeFile(routeFilePath, updated, 'utf-8');
}

// vite.config.ts's content depends on every app in the project, not just the one this command
// invocation is adding — that's global project state Handlebars has no way to see, so (unlike
// the rest of this generator's output) it's written directly here rather than from a template
// file. Regenerated on every `generate react` call so it never falls out of sync with the
// project's actual set of apps.
function renderViteConfig(appDirs: string[]): string {
  const appDirLiteral = appDirs.length === 1
    ? JSON.stringify(appDirs[0])
    : `[${appDirs.map((d) => JSON.stringify(d)).join(', ')}]`;
  return `import { createViteConfig } from "@rapidrest/react/vite";\n\nexport default createViteConfig({ appDir: ${appDirLiteral} });\n`;
}

// Same rationale as renderViteConfig — this file's content never actually varies per app
// ("apps" is already a broad include covering every app directory), but it still needs to
// survive a second `generate react` call without requiring --force, which a template-copied
// file can't do without special-casing collision handling.
const TSCONFIG_CLIENT_CONTENT = `${JSON.stringify(
  {
    extends: '@rapidrest/react/tsconfig/client',
    compilerOptions: { rootDir: '.', outDir: 'dist', sourceMap: false, declaration: false },
    include: ['apps'],
  },
  null,
  4,
)}\n`;

// `@rapidrest/react`'s multi-app export form treats "/" as a literal path segment (it's
// concatenated directly with each route's own leading slash), so a root-mounted app must pass
// "" instead — see StaticExportApp.routePrefix's doc comment in @rapidrest/react.
function toRoutePrefix(routePath: string): string {
  return routePath === '/' ? '' : routePath;
}

// src/export.ts's static-export configuration depends on every app in the project, exactly like
// vite.config.ts above — each app needs its own entry in runStaticExport()'s multi-app `apps`
// array, or a second `generate react` call would silently overwrite the first app's export
// config with only the new app's. Generated directly rather than templated, for the same reason
// as renderViteConfig. The single-app case deliberately keeps using the flat `appDir`/
// `routePrefix` form (rather than a one-entry `apps` array) since @rapidrest/react's multi-app
// form always writes output under a routePrefix subdirectory, whereas the flat form writes
// straight to outDir's root — switching every project to the array form would silently change
// where a single-app project's exported files land.
function renderExportEntry(apps: { appDir: string; routePath: string }[], author: string, year: number): string {
  const exportOptions = apps.length === 1
    ? `{ appDir: ${JSON.stringify(apps[0].appDir)}, routePrefix: ${JSON.stringify(toRoutePrefix(apps[0].routePath))} }`
    : `{\n        apps: [\n${apps
        .map((a) => `            { appDir: ${JSON.stringify(a.appDir)}, routePrefix: ${JSON.stringify(toRoutePrefix(a.routePath))} },`)
        .join('\n')}\n        ],\n    }`;

  return `#!/usr/bin/env node
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) ${year} ${author}
///////////////////////////////////////////////////////////////////////////////
import { fileURLToPath } from "url";
import { dirname } from "path";
import config from "./config.js";
import { Logger } from "@rapidrest/core";
import { ObjectFactory } from "@rapidrest/service-core";
import { runStaticExport } from "@rapidrest/react";

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const logLevel: string = config.get("logger:level") || (process.env.environment === "production" ? "info" : "debug");
const logger = Logger(logLevel, config.get("logger:file"));

const objectFactory = new ObjectFactory(config, logger);

const result = await runStaticExport(
    { config, basePath: _dirname, logger, objectFactory },
    ${exportOptions}
);
await objectFactory.destroy();

if (result.errors.length > 0) {
    for (const err of result.errors) {
        logger.error(\`[export] \${err.path}: \${err.status ?? err.error}\`);
    }
    console.error(\`[export] Completed with \${result.errors.length} error(s).\`);
    process.exit(1);
}

console.log(\`[export] Wrote \${result.pages.length} page(s) to dist/export.\`);
`;
}

export default class GenerateReact extends Command {
  static override args = {
    name: Args.string({ description: 'Name of the React app (e.g. app).', required: true }),
  };

  static override description = 'Adds React support to the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> app',
    '<%= config.bin %> <%= command.id %> app --path "/my-app"',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    author: Flags.string({ alias: 'a', description: 'The author to attribute the resulting source code to.' }),
    hydrate: Flags.boolean({ description: 'Enable client-side hydration. Required for interactive apps.' }),
    'no-install': Flags.boolean({ description: 'Skip running the package manager install after generating.' }),
    'output-dir': Flags.string({ description: 'Project directory to add React support to. Defaults to the current working directory.' }),
    path: Flags.string({ alias: 'p', description: 'The base path the React application will route to' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateReact);
    const cwd = flags['output-dir'] ?? process.cwd();
    const outputDir = cwd;
    const packageJsonBefore = await readPackageJsonRaw(cwd);

    this.log(`Generating react app: "${args.name}"...\n`);

    const routePath = flags.path ?? await input({
      message: 'Enter the base path the React application will route to:',
      default: `/${args.name}`,
      required: true,
    });

    const hydrate = flags.hydrate ?? await confirm({
      message: 'Enable client-side hydration? (required for interactive apps):',
      default: false
    });

    const author = flags.author ?? (await inputAuthor(cwd));

    // Migrate any existing app still on the old (non-namespaced) single-app layout before
    // generating the new one, so the project ends up with every app under apps/<name>/.
    let existingApps = await findExistingReactApps(cwd);
    const needsMigration = existingApps.filter((a) => !a.appDir.startsWith('apps/'));
    for (const app of needsMigration) {
      await migrateToNamespacedAppDir(cwd, app, (m) => this.log(m));
    }
    if (needsMigration.length > 0) {
      existingApps = await findExistingReactApps(cwd);
    }

    const year = new Date().getFullYear();

    const context: Record<string, unknown> = {
      author,
      className: toPascalCase(args.name),
      hydrate,
      name: args.name,
      path: routePath,
      project_name: await readProjectName(cwd),
      year,
    };

    const templateDir = join(this.config.root, 'templates', 'react');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: cwd });

      // vite.config.ts/tsconfig.client.json/src/export.ts all depend on every app in the project
      // (not just this one), so they're generated directly rather than copied from the template
      // — see renderViteConfig()'s comment. Always (re)written, covering both the first app and
      // every subsequent one, so they never need --force to survive a second `generate react` call.
      const allAppDirs = [...existingApps.map((a) => a.appDir), `apps/${args.name}`];
      const allApps = [...existingApps.map((a) => ({ appDir: a.appDir, routePath: a.routePath })), { appDir: `apps/${args.name}`, routePath }];
      await writeFile(join(outputDir, 'vite.config.ts'), renderViteConfig(allAppDirs), 'utf-8');
      await writeFile(join(outputDir, 'tsconfig.client.json'), TSCONFIG_CLIENT_CONTENT, 'utf-8');
      await writeFile(join(outputDir, 'src', 'export.ts'), renderExportEntry(allApps, author, year), 'utf-8');

      this.log(`\nReact app "${args.name}" generated at: ${join(outputDir, args.name + '.ts')}`);

      if (!flags['no-install']) {
        await installIfPackageJsonChanged(cwd, packageJsonBefore, (m) => this.log(m), (m) => this.warn(m));
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}