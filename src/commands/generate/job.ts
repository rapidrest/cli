import { input } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { readProjectName } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';

export default class GenerateJob extends Command {
  static override args = {
    name: Args.string({ description: 'Name of the background job (e.g. MetricsCollector, Notificatier).', required: true }),
  };

  static override description = 'Generate a RapidREST background job in the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> Job',
    '<%= config.bin %> <%= command.id %> Job --output-dir src/jobs',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    author: Flags.string({ alias: 'a', description: 'The author to attribute the resulting source code to.' }),
    description: Flags.string({ alias: 'd', description: "The short description of the job."}),
    schedule: Flags.string({alias: 's', description: "The crontab-style schedule that the job will execute with (e.g. `* * * * *` runs every second)."}),
    'output-dir': Flags.string({ alias: 'o', description: 'Directory to write the generated job into. Defaults to ./src/jobs.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateJob);
    const outputDir = flags['output-dir'] ?? process.cwd();

    this.log(`Generating background job "${args.name}"...\n`);

    const description = flags.description ?? await input({
      message: 'Enter a short description of this job:',
      required: true,
    });

    const author = flags.author ?? (await inputAuthor(process.cwd()));

    const schedule = flags.schedule ?? (await input({
      message: "Enter the execution schedule (crontab format):",
      default: "* * * *",
      required: true
    }));

    const context: Record<string, unknown> = {
      author,
      description,
      name: args.name,
      project_name: await readProjectName(process.cwd()),
      schedule,
      year: new Date().getFullYear(),
    };

    const templateDir = join(this.config.root, 'templates', 'job');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: process.cwd() });
      this.log(`\nJob "${args.name}" generated at: ${join(outputDir, args.name + '.ts')}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
