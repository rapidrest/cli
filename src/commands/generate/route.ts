///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { confirm, input, select, Separator } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { renderTemplate, templatesFlag, useTemplates } from '../../lib/templateCommand.js';
import {
  readProjectDatastores,
  readProjectModels,
  readModelDatastore,
  readModelProperty,
  formatExamplePropertyValue,
} from '../../lib/project.js';
import GenerateModel from './model.js';
import { inputAuthor } from '../../lib/prompts.js';

export default class GenerateRoute extends Command {
  static override args = {
    name: Args.string({ description: 'Name of the route class (e.g. ProductRoute, OrderRoute).', required: true }),
  };

  static override description = 'Generate a RapidREST route handler in the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> ProductRoute',
    '<%= config.bin %> <%= command.id %> ProductRoute --output-dir ../my-api --no-test',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    templates: templatesFlag,
    api: Flags.string({ description: "Use @ApiRoute instead of @Route for the generated route(s). Pass a value to specify an api version." }),
    author: Flags.string({ char: 'a', description: 'The author to attribute the resulting source code to.' }),
    description: Flags.string({ char: 'd', description: "The short description of the route."}),
    model: Flags.string({ char: 'm', description: "The name of the model class this route will serve data for (will extend ModelRoute)."}),
    'no-model': Flags.boolean({ description: 'Skip all prompts concerning associating a model class.' }),
    'output-dir': Flags.string({ description: 'Project directory to write the route into (under src/routes and test/routes). Defaults to the current directory.' }),
    path: Flags.string({ description: 'The base path of the route (e.g. /api/v1/products).' }),
    protect: Flags.boolean({ char: 'p', allowNo: true, description: "Enable RBAC-based protection of this route. --no-protect disables it without prompting."}),
    'no-api': Flags.boolean({ exclusive: ['api'], description: 'Use @Route rather than @ApiRoute, without prompting.' }),
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
    if (!api && !flags['no-api'] && await confirm({ message: "Is this an API route?" })) {
      api = await input({
        message: 'Enter the API version (enter blank for no version prefix):',
        default: '1',
        required: false
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
            await GenerateModel.run(flags.templates ? ['--templates', flags.templates] : [], this.config.root);
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
    let hasRedis: boolean = false;
    // Picks a real property off the model to exercise in the generated update tests, rather than
    // assuming a hardcoded field that may not exist on the model (e.g. a `status` enum).
    let examplePropertyName = 'name';
    let examplePropertyValue = '"updated"';
    const configured = await readProjectDatastores(cwd);
    if (model) {
      datastore = await readModelDatastore(cwd, model);
      if (datastore) {
        datastoreType = configured.find((d) => d.name === datastore)?.type ?? '';
        hasRedis = configured.find((d) => d.type === 'redis') ? true : hasRedis;
      }

      const property = await readModelProperty(cwd, model);
      if (property) {
        examplePropertyName = property.name;
        examplePropertyValue = formatExamplePropertyValue(property.type);
      }
    }

    const protect = flags.protect ?? await confirm({
      message: 'Enable RBAC-based protection for this route:',
      default: false
    });

    const author = flags.author ?? (await inputAuthor(cwd));

    const generateTest = !flags['no-test'];

    // The generated test talks to two datastores that may be of different kinds: the model's own
    // and the `acl` one (e.g. a SQL model in a project whose ACLs live in MongoDB). Each gets the
    // repository type of its own datastore, and the in-memory MongoDB the test config points at
    // starts whenever the server will connect to any MongoDB datastore, not only the model's.
    const modelIsMongo = datastoreType === 'mongodb';
    const aclType = configured.find((d) => d.name === 'acl')?.type;
    const aclIsMongo = aclType ? aclType === 'mongodb' : modelIsMongo;

    const context: Record<string, unknown> = {
      aclIsMongo,
      startMongo: modelIsMongo || configured.some((d) => d.type === 'mongodb'),
      usesMongoApi: modelIsMongo || aclIsMongo,
      usesSqlApi: !modelIsMongo || !aclIsMongo,
      apiRoute: api !== undefined,
      apiVersion: api,
      author,
      description,
      datastore,
      datastoreType,
      examplePropertyName,
      examplePropertyValue,
      hasRedis,
      model,
      name: args.name,
      path: routePath,
      protect,
      year: new Date().getFullYear(),
    };

    const templates = await useTemplates(this, cwd, 'project', flags.templates);

    const templateDir = join(templates.dir, 'route');

    try {
      await renderTemplate(this, templateDir, outputDir, context, { force: flags.force, projectDir: process.cwd() });
      this.log(`\nRoute "${args.name}" generated at: ${join(outputDir, 'src', 'routes', args.name + '.ts')}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
