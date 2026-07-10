import { confirm, input } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { readProjectName } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';

/**
 * Converts the first character of the given string to uppercase
 */
function toPascalCase(name: string): string {
  return `${name.substring(0,1).toUpperCase()}${name.substring(1)}`;
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
    'output-dir': Flags.string({ description: 'Project directory to add React support to. Defaults to the current working directory.' }),
    path: Flags.string({ alias: 'p', description: 'The base path the React application will route to' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateReact);
    const cwd = flags['output-dir'] ?? process.cwd();
    const outputDir = cwd;

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

    const context: Record<string, unknown> = {
      author,
      className: toPascalCase(args.name),
      hydrate,
      name: args.name,
      path: routePath,
      project_name: await readProjectName(cwd),
      year: new Date().getFullYear(),
    };

    const templateDir = join(this.config.root, 'templates', 'react');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: cwd });
      this.log(`\nReact app "${args.name}" generated at: ${join(outputDir, args.name + '.ts')}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}