///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { confirm, input, select, Separator } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { existsSync } from "fs";
import { join } from 'path';
import { renderTemplate, templatesFlag, useTemplates } from '../../lib/templateCommand.js';
import { formatDefaultPropertyValue, installIfPackageJsonChanged, readPackageJsonRaw, readProjectDatastores, readProjectName } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';
import GenerateDocker from './docker.js';
import GenerateHelm from './k8s.js';

export interface PropertyDefinition {
  name: string;
  type: string;
  optional: boolean;
  description: string;
  defaultValue: string;
}

// The base entity fields every model already has (BaseEntity/BaseMongoEntity) plus the template's
// own hardcoded `name` identifier — a user-defined property can't reuse any of these. Lowercased
// up front since the membership check below compares against a lowercased candidate name.
const RESERVED_PROPERTY_NAMES = new Set(
  ['name', 'uid', 'id', '_id', 'dateCreated', 'dateModified', 'version'].map((n) => n.toLowerCase()),
);

const PROPERTY_TYPE_CHOICES = [
  { name: 'string', value: 'string' },
  { name: 'number', value: 'number' },
  { name: 'boolean', value: 'boolean' },
  { name: 'string[]', value: 'string[]' },
  { name: 'number[]', value: 'number[]' },
  { name: 'Date', value: 'Date' },
  { name: 'Other… (enter a custom type)', value: '__other__' },
];

// Shared between the interactive prompt's `validate` callback (returns a message string on
// failure, `true` on success — inquirer's own convention) and the non-interactive --property flag
// parser (which turns a failure message into a thrown CLI error instead).
function validatePropertyName(name: string, existing: string[]): string | true {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    return `"${name}" is not a valid property name (must be a valid TypeScript identifier).`;
  }
  if (RESERVED_PROPERTY_NAMES.has(name.toLowerCase())) {
    return `"${name}" is already used by the model's base fields and can't be redeclared.`;
  }
  if (existing.some((e) => e.toLowerCase() === name.toLowerCase())) {
    return `"${name}" was already added as a property.`;
  }
  return true;
}

// An optional property always defaults to `undefined` regardless of type — matches how
// `@Nullable` properties are written throughout service-core's own example models (e.g.
// `uType: string | number | undefined = undefined`), rather than a type-specific zero value that
// would misleadingly suggest the property is always present.
function resolveDefaultValue(type: string, optional: boolean): string {
  return optional ? 'undefined' : formatDefaultPropertyValue(type);
}

// Parses one `--property name:type` (or `name:type?` for an optional property) flag value.
function parsePropertyFlag(raw: string, existing: PropertyDefinition[], error: (msg: string) => never): PropertyDefinition {
  const colonIndex = raw.indexOf(':');
  if (colonIndex === -1) {
    error(`Invalid --property "${raw}" — expected the form name:type (e.g. quantity:number, bio:string?).`);
  }
  const name = raw.slice(0, colonIndex).trim();
  let type = raw.slice(colonIndex + 1).trim();

  const nameCheck = validatePropertyName(name, existing.map((p) => p.name));
  if (nameCheck !== true) error(nameCheck);

  const optional = type.endsWith('?');
  if (optional) type = type.slice(0, -1).trim();
  if (!type) error(`Invalid --property "${raw}" — missing a type after the colon.`);

  return {
    name,
    type,
    optional,
    description: `The ${name} property.`,
    defaultValue: resolveDefaultValue(type, optional),
  };
}

// Allows `--cache` to be passed with no value (defaulting to '60'), with a value
// (e.g. `--cache 120`), or omitted entirely (triggering the interactive prompt below).
// oclif's string flags always consume the next token as their value, so a bare
// `--cache` at the end of argv or immediately followed by another flag would otherwise
// throw "Flag --cache expects a value" — this injects the default token in that case.
const DATASTORE_TYPES = ['mongodb', 'postgres', 'sqlite'] as const;
const DATASTORE_NAME = /^[A-Za-z_$][\w$]*$/;

/** Maps a configured datastore's TypeORM type back to the --datastore-type value that creates it. */
function normalizeDatastoreType(type: string): string {
  return type === 'better-sqlite3' ? 'sqlite' : type;
}

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
    templates: templatesFlag,
    author: Flags.string({ char: 'a', description: 'The author to attribute the resulting source code to.' }),
    cache: Flags.string({ char: 'c', description: "Set the cache TTL of this model. If passed with no value, defaults to 60." }),
    datastore: Flags.string({ aliases: ['ds'], description: "The name of the datastore that the model will be bound to."}),
    description: Flags.string({ char: 'd', description: "The short description of the model."}),
    'output-dir': Flags.string({ char: 'o', description: 'Project directory to write the model into (under src/models). Defaults to the current directory.' }),
    'datastore-type': Flags.string({ options: [...DATASTORE_TYPES], description: "The type of the new datastore to set up when --datastore names one that isn't configured yet. Without --datastore, sets up (or reuses) a datastore named after the type." }),
    'no-cache': Flags.boolean({ exclusive: ['cache'], description: "Don't enable caching for this model (skips the prompt)." }),
    protect: Flags.boolean({ char: 'p', allowNo: true, description: "Enable RBAC-based protection of this model. --no-protect disables it without prompting."}),
    'no-properties': Flags.boolean({ exclusive: ['property'], description: 'Add no properties beyond the inherited ones (skips the property prompts).' }),
    'update-docker': Flags.boolean({ allowNo: true, description: 'When a new datastore is set up and the project has Docker support, whether to regenerate the Docker files (overwriting them). Prompted for if omitted.' }),
    'update-k8s': Flags.boolean({ allowNo: true, description: 'When a new datastore is set up and the project has Helm support, whether to regenerate the Helm chart (overwriting it). Prompted for if omitted.' }),
    property: Flags.string({ description: 'Add a typed property to the model, as name:type (e.g. quantity:number). Append ? to the type to make it optional (e.g. bio:string?). Repeatable.', multiple: true }),
    'no-install': Flags.boolean({ description: 'Skip running the package manager install after generating.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateModel, resolveCacheArgv(this.argv));
    const outputDir = flags['output-dir'] ?? process.cwd();
    // package.json patches always target process.cwd() (see processTemplate's projectDir option
    // below), regardless of --output-dir — captured before any of this command's own writes, or
    // the nested Docker/Helm regeneration below, so the single install check at the end covers both.
    const packageJsonBefore = await readPackageJsonRaw(process.cwd());

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

    const selectDatastoreType = async (message: string): Promise<string> =>
      flags['datastore-type'] ?? await select<string>({
        message,
        choices: [
          { name: 'MongoDB', value: 'mongodb' },
          { name: 'PostgreSQL', value: 'postgres' },
          { name: 'sqlite', value: 'sqlite' },
        ],
        default: 'mongodb',
      });

    if (flags.datastore !== undefined) {
      datastore = flags.datastore;
      if (!DATASTORE_NAME.test(datastore)) {
        this.error(`Invalid --datastore "${datastore}". A datastore name must be a valid identifier (e.g. mongo, orders).`);
      }
      const existing = configured.find((d) => d.name === datastore);
      if (existing) {
        datastoreType = existing.type;
        if (flags['datastore-type'] !== undefined && normalizeDatastoreType(existing.type) !== flags['datastore-type']) {
          this.error(`The "${datastore}" datastore is already configured as type "${existing.type}", not "${flags['datastore-type']}".`);
        }
      } else {
        // An unknown name sets up a new datastore of that name, rather than binding the model to a
        // datastore that doesn't exist (an empty, type-less config block the server can't start with).
        const known = selectable.map((d) => d.name);
        datastoreType = await selectDatastoreType(
          `No datastore named "${datastore}" is configured${known.length > 0 ? ` (configured: ${known.join(', ')})` : ''}. ` +
          'Select the database type to create it as:');
        newDatastore = true;
      }
    } else if (flags['datastore-type'] !== undefined) {
      // A new datastore named after its type, as the interactive flow below creates, unless one by
      // that name already exists.
      datastore = flags['datastore-type'];
      const existing = configured.find((d) => d.name === datastore);
      datastoreType = existing?.type ?? flags['datastore-type'];
      newDatastore = !existing;
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
        datastoreType = await selectDatastoreType('Select database type:');
        datastore = datastoreType;
        newDatastore = !configured.some((d) => d.name === datastore);
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
        datastoreType = await selectDatastoreType('Select database type:');
        datastore = datastoreType;
        newDatastore = true;
      } else {
        datastore = '';
        datastoreType = '';
      }
    }

    let cache = flags.cache ?? '';
    if (!cache && !flags['no-cache'] && await confirm({ message: "Enable caching for this model?" })) {
      cache = await input({
        message: 'Enter a cache TTL for this model:',
        default: '60',
        required: true
      });
    }

    const protect = flags.protect ?? await confirm({
      message: 'Enable RBAC-based protection for this model:',
      default: true
    });

    const properties: PropertyDefinition[] = [];
    if (flags.property || flags['no-properties']) {
      for (const raw of flags.property ?? []) {
        properties.push(parsePropertyFlag(raw, properties, (msg) => this.error(msg)));
      }
    } else {
      while (true) {
        const name = await input({
          message: 'Property name (leave blank to finish adding properties):',
          required: false,
          validate: (value) => (value ? validatePropertyName(value, properties.map((p) => p.name)) : true),
        });
        if (!name) break;

        const typeChoice = await select<string>({
          message: 'Property type:',
          choices: PROPERTY_TYPE_CHOICES,
        });
        const type = typeChoice === '__other__'
          ? await input({ message: 'Enter the TypeScript type:', required: true })
          : typeChoice;

        const optional = await confirm({ message: 'Is this property optional?', default: false });

        const propDescription = await input({
          message: 'Short description of this property (optional):',
          required: false,
        });

        properties.push({
          name,
          type,
          optional,
          description: propDescription || `The ${name} property.`,
          defaultValue: resolveDefaultValue(type, optional),
        });
      }
    }

    const author = flags.author ?? (await inputAuthor(process.cwd()));

    const context: Record<string, unknown> = {
      author,
      cache,
      name: args.name,
      description,
      datastore,
      datastoreType,
      protect,
      properties,
      hasOptionalProperty: properties.some((p) => p.optional),
      year: new Date().getFullYear(),
      project_name: await readProjectName(process.cwd()),
      // `datastoreType` is either the friendly value picked in the "Select database type" prompt
      // below ('mongodb'/'postgres'/'sqlite') when setting up a brand new datastore, or read back
      // verbatim from an existing datastore's `type:` field in config.ts otherwise — which, for a
      // SQL store, is TypeORM's own driver literal ('postgres'/'better-sqlite3', not 'postgresql'/
      // 'sqlite' — see the DatabaseType union in typeorm/driver/types/DatabaseType.ts). Both forms
      // are accepted here so an existing sqlite datastore is still recognized correctly.
      isMongoDb:    datastoreType === 'mongodb',
      isPostgreSql: datastoreType === 'postgres',
      isSqlite:     datastoreType === 'sqlite' || datastoreType === 'better-sqlite3',
      isRedis:      datastoreType === 'redis',
      // Only a datastore this command sets up is added to src/config.ts and test/config.ts.
      newDatastore,
    };

    const templates = await useTemplates(this, process.cwd(), 'project', flags.templates);

    const templateDir = join(templates.dir, 'model');

    try {
      await renderTemplate(this, templateDir, outputDir, context, { force: flags.force, projectDir: process.cwd() });
      this.log(`\nModel "${args.name}" generated at: ${join(outputDir, 'src', 'models', args.name + '.ts')}`);

      if (newDatastore) {
        if (existsSync(join(outputDir, "docker-compose.yml"))) {
          const answer = flags['update-docker'] ?? await confirm({
            message: "Update docker files? (this will overwrite all files)",
            default: true
          });
          if (answer) {
            this.log('\nUpdating Docker support...');
            await GenerateDocker.run([
              '--output-dir', outputDir, '--templates', templates.dir, '--force',
            ], this.config.root);
          }
        }

        if (existsSync(join(outputDir, "helm", "Chart.yaml"))) {
          const answer = flags['update-k8s'] ?? await confirm({
            message: "Update Kubernetes (Helm) files? (this will overwrite all files)",
            default: true
          });
          if (answer) {
            this.log('\nUpdating Kubernetes (Helm) support...');
            await GenerateHelm.run([
              '--output-dir', outputDir, '--templates', templates.dir, '--force', '--no-install',
            ], this.config.root);
          }
        }
      }

      if (!flags['no-install']) {
        await installIfPackageJsonChanged(process.cwd(), packageJsonBefore, (m) => this.log(m), (m) => this.warn(m));
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
