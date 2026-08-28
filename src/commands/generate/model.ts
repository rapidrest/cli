///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { confirm, input, select, Separator } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { existsSync } from "fs";
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
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

    let cache = flags.cache ?? '';
    if (!cache && await confirm({ message: "Enable caching for this model?" })) {
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
    if (flags.property) {
      for (const raw of flags.property) {
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
              '--output-dir', outputDir, '--force', '--no-install'
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
