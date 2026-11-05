///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { confirm } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { renderTemplate, templatesFlag, useTemplates } from '../../lib/templateCommand.js';
import { findExistingReactApps, readProjectName } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';

// Converts a (possibly slash-delimited) page path like "my/path/page" into a
// PascalCase identifier ("MyPathPage") for use as the component/service class name.
function toPascalCase(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => segment
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(''))
    .join('');
}

export default class GenerateReactPage extends Command {
  static override args = {
    app: Args.string({ description: 'The name of the React app (e.g. app).', required: true }),
    name: Args.string({ description: 'Name of the page, optionally with a subpath (e.g. page, my/path/page).', required: true }),
  };

  static override description = 'Adds a new page to an existing React app to the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> app page',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    templates: templatesFlag,
    author: Flags.string({ char: 'a', description: 'The author to attribute the resulting source code to.' }),
    'output-dir': Flags.string({ description: 'Project directory to add React support to. Defaults to the current working directory.' }),
    service: Flags.boolean({ char: 's', allowNo: true, description: 'Creates a service class for performing server-side data retrieval for the page. --no-service skips it without prompting.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateReactPage);
    const cwd = flags['output-dir'] ?? process.cwd();
    const outputDir = cwd;

    this.log(`Generating react page: app=${args.app}, page=${args.name}...\n`);

    const author = flags.author ?? (await inputAuthor(cwd));

    const service = flags.service ?? (await confirm({
      message: 'Create a service class for performing server-side data retrieval?',
      default: true
    }));

    const className = toPascalCase(args.name);

    // @rapidrest/react registers a @ReactService only under the route whose mount path prefixes it,
    // so the service's path must be the page's public URL (the app's @Route path plus the page),
    // not the app's directory name. Falls back to `generate react`'s default mount, /<app>.
    const existingApp = (await findExistingReactApps(cwd)).find((a) => a.appDir.replace(/^\.\//, '') === `apps/${args.app}`);
    if (!existingApp) {
      this.warn(`No ReactRoute found for apps/${args.app}; assuming it is mounted at /${args.app}.`);
    }
    const routePrefix = (existingApp?.routePath ?? `/${args.app}`).replace(/\/\*?$/, '');
    const pagePath = args.name.replace(/^\/+|\/+$/g, '');
    const servicePath = `${routePrefix}/${pagePath}`;

    const context: Record<string, unknown> = {
      author,
      app: args.app,
      name: args.name,
      className,
      project_name: await readProjectName(cwd),
      service,
      servicePath,
      year: new Date().getFullYear(),
    };

    const templates = await useTemplates(this, cwd, 'project', flags.templates);

    const templateDir = join(templates.dir, 'react-page');

    try {
      await renderTemplate(this, templateDir, outputDir, context, { force: flags.force, projectDir: cwd });
      this.log(`\nReact app page "${args.name}" generated at: ${join(outputDir, 'apps', args.app, args.name, 'index.tsx')}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
