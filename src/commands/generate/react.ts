import { input, select } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { readGitAuthor, readProjectAuthor, readProjectName } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';

export default class GenerateReact extends Command {
  static override args = {
    name: Args.string({ description: 'Name of the React app (e.g. app).', required: true }),
  };

  static override description = 'Adds RapidREST React support to the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> app',
    '<%= config.bin %> <%= command.id %> app --path "/my-app"',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    author: Flags.string({ alias: 'a', description: 'The author to attribute the resulting source code to.' }),
    hydrate: Flags.boolean({ description: 'Enable client-side hydration. Required for interactive apps.' }),
    path: Flags.string({ alias: 'p', description: 'The base path the React application will route to' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateReact);
    const outputDir = process.cwd();

    this.log(`Generating model "${args.name}"...\n`);

    const routePath = flags.path ?? await input({
      message: 'Enter the base path the React application will route to:',
      default: `/${args.name}`,
      required: true,
    });

    const hydrate = flags.hydrate ?? await select<boolean>({
      message: 'Enable client-side hydration? (required for interactive apps):',
      choices: [
        { name: 'yes', value: true },
        { name: 'no', value: false },
      ],
      default: false
    });

    const author = flags.author ?? (await inputAuthor(process.cwd()));

    const context: Record<string, unknown> = {
      author,
      hydrate,
      name: args.name,
      path: routePath,
      project_name: await readProjectName(process.cwd()),
      year: new Date().getFullYear(),
    };

    const templateDir = join(this.config.root, 'templates', 'react');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: process.cwd() });
      this.log(`\nReact app "${args.name}" generated at: ${join(outputDir, args.name + '.ts')}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
