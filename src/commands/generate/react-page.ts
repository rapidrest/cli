import { confirm } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { readProjectName } from '../../lib/project.js';
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
    author: Flags.string({ alias: 'a', description: 'The author to attribute the resulting source code to.' }),
    'output-dir': Flags.string({ description: 'Project directory to add React support to. Defaults to the current working directory.' }),
    service: Flags.boolean({ char: 's', description: 'Creates a service class for performing server-side data retrieval for the page.' }),
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

    const context: Record<string, unknown> = {
      author,
      app: args.app,
      name: args.name,
      className,
      project_name: await readProjectName(cwd),
      service,
      year: new Date().getFullYear(),
    };

    const templateDir = join(this.config.root, 'templates', 'react-page');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: cwd });
      this.log(`\nReact app page "${args.name}" generated at: ${join(outputDir, 'apps', args.app, args.name, 'index.tsx')}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
