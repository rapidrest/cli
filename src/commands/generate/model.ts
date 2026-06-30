import { input, select } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { readProjectAuthor, readProjectDatastores, readProjectName } from '../../lib/project.js';

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
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    author: Flags.string({ alias: 'a', description: 'The author to attribute the resulting source code to.' }),
    cache: Flags.boolean({ char: 'c', description: "Enable caching of this model."}),
    datastore: Flags.string({ alias: 'ds', description: "The name of the datastore that the model will be bound to."}),
    description: Flags.string({ alias: 'd', description: "The short description of the model."}),
    'output-dir': Flags.string({ alias: 'o', description: 'Directory to write the generated model into. Defaults to ./src/models.' }),
    protect: Flags.boolean({ char: 'p', description: "Enable RBAC-based protection of this model."}),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateModel);
    const outputDir = flags['output-dir'] ?? join(process.cwd(), 'src', 'models');

    this.log(`Generating model "${args.name}"...\n`);

    const description = flags.description ?? await input({
      message: 'Enter a short description of this model',
      required: true,
    });

    const configured = await readProjectDatastores(process.cwd());

    let datastore: string;
    let datastoreType: string;

    if (flags.datastore !== undefined) {
      datastore = flags.datastore;
      datastoreType = configured.find((d) => d.name === flags.datastore)?.type ?? '';
    } else if (configured.length > 0) {
      const selectedName = await select<string>({
        message: 'Select the datastore for this model',
        choices: configured.map((d) => ({ name: `${d.name} (${d.type})`, value: d.name })),
      });
      datastore = selectedName;
      datastoreType = configured.find((d) => d.name === selectedName)?.type ?? '';
    } else {
      const setupNew = await select<boolean>({
        message: 'No datastores configured in this project. Set up a new database?',
        choices: [
          { name: 'yes', value: true },
          { name: 'no', value: false },
        ],
        default: true
      });
      if (setupNew) {
        datastoreType = await select<string>({
          message: 'Select database type',
          choices: [
            { name: 'MongoDB', value: 'mongodb' },
            { name: 'PostgreSQL', value: 'postgres' },
            { name: 'sqlite', value: 'sqlite' },
          ],
          default: 'mongodb',
        });
        datastore = datastoreType;
      } else {
        datastore = '';
        datastoreType = '';
      }
    }

    const cache = flags.cache ?? await select<boolean>({
      message: 'Enable caching for this model',
      choices: [
        { name: 'yes', value: true },
        { name: 'no', value: false },
      ],
      default: true
    });

    const protect = flags.protect ?? await select<boolean>({
      message: 'Enable RBAC-based protection for this model',
      choices: [
        { name: 'yes', value: true },
        { name: 'no', value: false },
      ],
    });

    const author = flags.author ??
      (await readProjectAuthor(process.cwd())) ??
      (await input({ message: 'Enter the author name', required: true }));

    const context: Record<string, unknown> = {
      author,
      cache,
      name: args.name,
      description,
      datastore,
      datastoreType,
      protect,
      year: new Date().getFullYear(),
      project_name: await readProjectName(process.cwd()),
      isMongoDb:    datastoreType === 'mongodb',
      isPostgreSql: datastoreType === 'postgresql',
      isSqlite:     datastoreType === 'sqlite',
      isRedis:      datastoreType === 'redis',
    };

    // The model template has a single file at src/models/{{name}}.ts
    // We point processTemplate at the template root and let it resolve the output path
    // relative to outputDir (stripping the leading src/models/ prefix by templating directly)
    const templateDir = join(this.config.root, 'templates', 'model', 'src', 'models');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: process.cwd() });
      this.log(`\nModel "${args.name}" generated at: ${join(outputDir, args.name + '.ts')}`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
