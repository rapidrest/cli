import { input } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { readProjectAuthor } from '../../lib/project.js';

export default class GenerateRoute extends Command {
  static override args = {
    name: Args.string({ description: 'Name of the route class (e.g. ProductRoute, AuthRoute).', required: true }),
  };

  static override description = 'Generate a RapidREST route handler in the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> ProductRoute',
    '<%= config.bin %> <%= command.id %> ProductRoute --output-dir src/routes --no-test',
  ];

  static override flags = {
    force: Flags.boolean({ description: 'Overwrite existing files.' }),
    'no-test': Flags.boolean({ description: 'Skip generating the test file.' }),
    'output-dir': Flags.string({ description: 'Directory to write the generated route into. Defaults to ./src/routes.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateRoute);
    const outputDir = flags['output-dir'] ?? join(process.cwd(), 'src', 'routes');
    const testDir = join(process.cwd(), 'test');

    this.log(`Generating route "${args.name}"...\n`);

    const description = await input({
      message: 'Enter a short description of this route',
      required: true,
    });

    const routePath = await input({
      message: 'Enter the base route path (e.g. /api/v1/products)',
      required: true,
    });

    const author =
      (await readProjectAuthor(process.cwd())) ??
      (await input({ message: 'Enter the author name', required: true }));

    const generateTest = !flags['no-test'];

    const context: Record<string, unknown> = {
      name: args.name,
      description,
      path: routePath,
      author,
      year: new Date().getFullYear(),
    };

    const routeTemplateDir = join(this.config.root, 'templates', 'route', 'src', 'routes');
    const testTemplateDir = join(this.config.root, 'templates', 'route', 'test');

    try {
      await processTemplate(routeTemplateDir, outputDir, context, { force: flags.force });
      this.log(`\nRoute "${args.name}" generated at: ${join(outputDir, args.name + '.ts')}`);

      if (generateTest) {
        await processTemplate(testTemplateDir, testDir, context, { force: flags.force });
        this.log(`Test file generated at: ${join(testDir, args.name + '.test.ts')}`);
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
