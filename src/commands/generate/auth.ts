///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { select } from '@inquirer/prompts';
import { Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { detectApiRoute, readProjectDatastores, readProjectName } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';

const DATASTORE_TYPES = ['sql', 'mongo'];
const SQL_TYPES = ['postgres', 'better-sqlite3'];

export default class GenerateAuth extends Command {
  static override args = {};

  static override description = [
    'Add login/session scaffolding to the current project, backed by @rapidrest/auth: self-service',
    'registration, HTTP Basic login, logout, and admin user management.',
    '',
    'Out of scope for this command (all real, working parts of @rapidrest/auth, just not scaffolded',
    'here): MFA, OIDC, FIDO2, Passkey, TOTP, session refresh, account elevation, auth-method',
    'discovery, and direct Profile/Account/Alias/Secret management routes. Add those by hand,',
    'following the same pattern as the routes this command generates.',
  ].join('\n');

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --datastore-type sql --sql-type sqlite',
    '<%= config.bin %> <%= command.id %> --datastore-type mongo --default-accounts',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    author: Flags.string({ alias: 'a', description: 'The author to attribute the resulting source code to.' }),
    'output-dir': Flags.string({ description: 'Directory to write the generated files into. Defaults to the current working directory.' }),
    'datastore-type': Flags.string({ description: `Which datastore backs authentication data. One of: ${DATASTORE_TYPES.join(', ')}` }),
    'sql-type': Flags.string({ description: `When --datastore-type sql and no "sql" datastore exists yet, which SQL database to create it as. One of: ${SQL_TYPES.join(', ')}` }),
    'default-accounts': Flags.boolean({ description: 'Also provision a default admin account the first time the server boots against an empty user table.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateAuth);
    const cwd = process.cwd();
    const outputDir = flags['output-dir'] ?? cwd;

    this.log('Generating authentication scaffolding...\n');

    if (flags['datastore-type'] !== undefined && !DATASTORE_TYPES.includes(flags['datastore-type'])) {
      this.error(`Invalid --datastore-type "${flags['datastore-type']}". Must be one of: ${DATASTORE_TYPES.join(', ')}`);
    }
    const datastoreType = flags['datastore-type'] ?? await select<string>({
      message: 'Which datastore should back authentication data?',
      choices: [
        { name: 'SQL (PostgreSQL / SQLite)', value: 'sql' },
        { name: 'MongoDB', value: 'mongo' },
      ],
    });
    const isSql = datastoreType === 'sql';

    const configured = await readProjectDatastores(cwd);
    const existing = configured.find((d) => d.name === datastoreType);

    let isPostgreSql = false;
    let isSqlite = false;
    if (isSql) {
      if (existing) {
        isPostgreSql = existing.type === 'postgres';
        isSqlite = existing.type === 'better-sqlite3';
      } else {
        if (flags['sql-type'] !== undefined && !SQL_TYPES.includes(flags['sql-type'])) {
          this.error(`Invalid --sql-type "${flags['sql-type']}". Must be one of: ${SQL_TYPES.join(', ')}`);
        }
        const sqlType = flags['sql-type'] ?? await select<string>({
          message: 'No "sql" datastore is configured yet — select the SQL database type to create it as:',
          choices: [
            { name: 'PostgreSQL', value: 'postgres' },
            { name: 'SQLite', value: 'better-sqlite3' },
          ],
        });
        isPostgreSql = sqlType === 'postgres';
        isSqlite = sqlType === 'better-sqlite3';
      }
    }

    const author = flags.author ?? (await inputAuthor(cwd));
    const apiInfo = await detectApiRoute(cwd);

    const context: Record<string, unknown> = {
      author,
      year: new Date().getFullYear(),
      project_name: await readProjectName(cwd),
      // Always set (even when the datastore already exists) — the ts-block-insert patch is
      // idempotent per its own idempotencyKey, so reusing an existing "sql"/"mongo" datastore is a
      // safe no-op rather than something this command needs to pre-check itself.
      datastore: datastoreType,
      isSql,
      isPostgreSql,
      isSqlite,
      apiRoute: apiInfo.apiRoute,
      apiVersion: apiInfo.apiVersion,
      defaultAccounts: flags['default-accounts'] ?? false,
    };

    const templateDir = join(this.config.root, 'templates', 'auth');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: cwd });
      this.log(`\nAuthentication scaffolding generated at: ${outputDir}`);
      this.log(`\n@rapidrest/auth and argon2 were added to package.json — install dependencies before building.`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
