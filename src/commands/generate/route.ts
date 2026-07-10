import { confirm, input, select, Separator } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import {
  readGitAuthor,
  readProjectAuthor,
  readProjectDatastores,
  readProjectModels,
  readModelDatastore,
} from '../../lib/project.js';
import GenerateModel from './model.js';
import { inputAuthor } from '../../lib/prompts.js';

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
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    api: Flags.string({ description: "Use @ApiRoute instead of @Route for the generated route(s). Pass a value to specify an api version." }),
    author: Flags.string({ alias: 'a', description: 'The author to attribute the resulting source code to.' }),
    description: Flags.string({ alias: 'd', description: "The short description of the route."}),
    model: Flags.string({ alias: 'm', description: "The name of the model class this route will serve data for (will extend ModelRoute)."}),
    'no-model': Flags.boolean({ description: 'Skip all prompts concerning associating a model class.' }),
    'output-dir': Flags.string({ description: 'Directory to write the generated route into. Defaults to ./src/routes.' }),
    path: Flags.string({ description: 'The base path of the route (e.g. /api/v1/products).' }),
    protect: Flags.boolean({ char: 'p', description: "Enable RBAC-based protection of this route."}),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateRoute);
    const cwd = process.cwd();
    const outputDir = flags['output-dir'] ?? cwd;
    const testDir = join(cwd, 'test');

    this.log(`Generating route: "${args.name}"...\n`);

    const description = flags.description ?? await input({
      message: 'Enter a short description of this route:',
      required: true,
    });

    const routePath = flags.path ?? await input({
      message: 'Enter the base route path (e.g. /api/v1/products):',
      required: true,
    });

    let api = flags.api ?? undefined;
    if (!api && await confirm({ message: "Is this an API route?" })) {
      api = await input({
        message: 'Enter the API version (enter blank for no version prefix):',
        default: '1',
        required: true
      });
    }

    // Model selection — offer existing project models via a select when available.
    let model: string | undefined = undefined;
    if (!flags['no-model']) {
      if (flags.model !== undefined) {
        model = flags.model;
      } else {
        const projectModels = await readProjectModels(cwd);
        if (projectModels.length > 0) {
          const selected = await select<string>({
            message: 'Select the model class this route will serve [optional]:',
            choices: [
              { name: '(none)', value: '' },
              ...projectModels.map((m) => ({ name: m, value: m })),
              new Separator(),
              { name: '+ New model...', value: '__new__' },
            ],
          });
          if (selected === '__new__') {
            this.log('');
            const modelsBefore = new Set(await readProjectModels(cwd));
            await GenerateModel.run([], this.config.root);
            this.log('');
            const modelsAfter = await readProjectModels(cwd);
            model = modelsAfter.find((m) => !modelsBefore.has(m)) ?? '';
          } else {
            model = selected;
          }
        } else {
          model = await input({
            message: 'Enter the name of the model class this route will serve data for (will extend ModelRoute) [optional]:',
            required: false,
          });
        }
      }
    }

    // Resolve the datastore binding and its type from the selected model's source file.
    let datastore = '';
    let datastoreType = '';
    if (model) {
      datastore = await readModelDatastore(cwd, model);
      if (datastore) {
        const configured = await readProjectDatastores(cwd);
        datastoreType = configured.find((d) => d.name === datastore)?.type ?? '';
      }
    }

    const protect = flags.protect ?? await confirm({
      message: 'Enable RBAC-based protection for this route:',
      default: false
    });

    const author = flags.author ?? (await inputAuthor(cwd));

    const generateTest = !flags['no-test'];

    const context: Record<string, unknown> = {
      apiRoute: api !== undefined,
      apiVersion: api,
      author,
      name: args.name,
      description,
      model,
      datastore,
      datastoreType,
      path: routePath,
      protect,
      year: new Date().getFullYear(),
    };

    const templateDir = join(this.config.root, 'templates', 'route');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: process.cwd() });
      this.log(`\nRoute "${args.name}" generated at: ${join(outputDir, args.name + '.ts')}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
