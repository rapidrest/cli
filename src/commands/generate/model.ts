import { confirm, input, select, Separator } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { existsSync } from "fs";
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { readProjectDatastores, readProjectName } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';
import GenerateDocker from './docker.js';
import GenerateHelm from './k8s.js';

// Allows `--cache` to be passed with no value (defaulting to '60'), with a value
// (e.g. `--cache 120`), or omitted entirely (triggering the interactive prompt below).
// oclif's string flags always consume the next token as their value, so a bare
// `--cache` at the end of argv or immediately followed by another flag would otherwise
// throw "Flag --cache expects a value" — this injects the default token in that case.
function resolveCacheArgv(argv: string[]): string[] {
  const result = [...argv];
  for (let i = 0; i < result.length; i++) {
    if (result[i] !== '--cache' && result[i] !== '-c') continue;
    const next = result[i + 1];
    if (next === undefined || next.startsWith('-')) {
      result.splice(i + 1, 0, '60');
    }
    break;
  }
  return result;
}

export default class GenerateModel extends Command {
  static override args = {
    name: Args.string({ description: 'Name of the model class (e.g. Product, UserProfile).', required: true }),
  };

  static override description = 'Generate a RapidREST data model in the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> Product',
    '<%= config.bin %> <%= command.id %> UserProfile --cache --datastore mongo',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    author: Flags.string({ alias: 'a', description: 'The author to attribute the resulting source code to.' }),
    cache: Flags.string({ alias: 'c', description: "Set the cache TTL of this model. If passed with no value, defaults to 60." }),
    datastore: Flags.string({ alias: 'ds', description: "The name of the datastore that the model will be bound to."}),
    description: Flags.string({ alias: 'd', description: "The short description of the model."}),
    'output-dir': Flags.string({ alias: 'o', description: 'Directory to write the generated model into. Defaults to ./src/models.' }),
    protect: Flags.boolean({ char: 'p', description: "Enable RBAC-based protection of this model."}),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateModel, resolveCacheArgv(this.argv));
    const outputDir = flags['output-dir'] ?? process.cwd();

    this.log(`Generating data model: "${args.name}"...\n`);

    const description = flags.description ?? await input({
      message: 'Enter a short description of this model:',
      required: true,
    });

    const configured = await readProjectDatastores(process.cwd());
    const selectable = configured.filter((d) => d.name !== 'acl');

    let datastore: string;
    let datastoreType: string;
    let newDatastore: boolean = false;

    if (flags.datastore !== undefined) {
      datastore = flags.datastore;
      datastoreType = configured.find((d) => d.name === flags.datastore)?.type ?? '';
    } else if (selectable.length > 0) {
      const selectedName = await select<string>({
        message: 'Select the datastore for this model:',
        choices: [
          ...selectable.map((d) => ({ name: `${d.name} (${d.type})`, value: d.name })),
          new Separator(),
          { name: '+ New datastore...', value: '__new__' },
        ],
      });
      if (selectedName === '__new__') {
        datastoreType = await select<string>({
          message: 'Select database type:',
          choices: [
            { name: 'MongoDB', value: 'mongodb' },
            { name: 'PostgreSQL', value: 'postgres' },
            { name: 'sqlite', value: 'sqlite' },
          ],
          default: 'mongodb',
        });
        datastore = datastoreType;
        newDatastore = true;
      } else {
        datastore = selectedName;
        datastoreType = configured.find((d) => d.name === selectedName)?.type ?? '';
      }
    } else {
      const setupNew = await confirm({
        message: 'No datastores configured in this project. Set up a new database?',
        default: true
      });
      if (setupNew) {
        datastoreType = await select<string>({
          message: 'Select database type:',
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

    const cache = flags.cache ?? await input({
      message: 'Enter a cache TTL for this model (enter blank to disable caching):',
      default: '60',
      required: false
    });

    const protect = flags.protect ?? await confirm({
      message: 'Enable RBAC-based protection for this model:',
      default: true
    });

    const author = flags.author ?? (await inputAuthor(process.cwd()));

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

    const templateDir = join(this.config.root, 'templates', 'model');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: process.cwd() });
      this.log(`\nModel "${args.name}" generated at: ${join(outputDir, args.name + '.ts')}`);

      if (newDatastore) {
        if (existsSync(join(outputDir, "docker-compose.yml"))) {
          const answer = await confirm({
            message: "Update docker files? (this will overwrite all files)",
            default: true
          });
          if (answer) {
            this.log('\nUpdating Docker support...');
            await GenerateDocker.run([
              '--output-dir', outputDir, '--force'
            ], this.config.root);
          }
        }

        if (existsSync(join(outputDir, "helm", "Chart.yaml"))) {
          const answer = await confirm({
            message: "Update Kubernetes (Helm) files? (this will overwrite all files)",
            default: true
          });
          if (answer) {
            this.log('\nUpdating Kubernetes (Helm) support...');
            await GenerateHelm.run([
              '--output-dir', outputDir, '--force'
            ], this.config.root);
          }
        }
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
