import { input } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { readProjectAuthor } from '../../lib/project.js';

export default class GenerateModel extends Command {
  static override args = {
    name: Args.string({ description: 'Name of the model class (e.g. Product, UserProfile).', required: true }),
  };

  static override description = 'Generate a RapidREST model class in the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> Product',
    '<%= config.bin %> <%= command.id %> UserProfile --output-dir src/models',
  ];

  static override flags = {
    force: Flags.boolean({ description: 'Overwrite existing files.' }),
    'output-dir': Flags.string({ description: 'Directory to write the generated model into. Defaults to ./src/models.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateModel);
    const outputDir = flags['output-dir'] ?? join(process.cwd(), 'src', 'models');

    this.log(`Generating model "${args.name}"...\n`);

    const description = await input({
      message: 'Enter a short description of this model',
      required: true,
    });

    const datastore = await input({
      message: 'Enter the datastore name (e.g. mongo, postgres)',
      default: 'mongo',
      required: true,
    });

    const author =
      (await readProjectAuthor(process.cwd())) ??
      (await input({ message: 'Enter the author name', required: true }));

    const context: Record<string, unknown> = {
      name: args.name,
      description,
      datastore,
      author,
      year: new Date().getFullYear(),
    };

    // The model template has a single file at src/models/{{name}}.ts
    // We point processTemplate at the template root and let it resolve the output path
    // relative to outputDir (stripping the leading src/models/ prefix by templating directly)
    const templateDir = join(this.config.root, 'templates', 'model', 'src', 'models');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force });
      this.log(`\nModel "${args.name}" generated at: ${join(outputDir, args.name + '.ts')}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
