///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { checkbox, confirm, input, select, Separator } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { installIfPackageJsonChanged } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';
import GenerateDocker from './docker.js';
import GenerateHelm from './k8s.js';
import GenerateReact from './react.js';
import GenerateDefaultRoute from './default-route.js';

const DB_FEATURES = ['mongodb', 'postgresql', 'redis', 'sqlite'];
// Deliberately excludes 'static' — unlike `generate default-route`'s own --type, the "other
// features" checkbox this mirrors has never offered a Static route option.
const ROUTE_TYPES = ['acl', 'admin', 'metrics', 'openapi', 'push', 'status'];
const PKG_MANAGERS = ['npm', 'yarn'];
const SCM_CHOICES = ['github', 'gitlab', 'git', 'p4', 'svn', 'none'];

// Every key here mirrors a flag name (camelCase), so the --answers file and the flags it's an
// alternative/supplement to stay in lockstep and are documented in one place (the README).
interface AnswersFile {
  description?: string;
  author?: string;
  pkgManager?: string;
  db?: string[];
  route?: string[];
  react?: boolean;
  docker?: boolean;
  k8s?: boolean;
  apiRoute?: boolean;
  apiVersion?: string;
  scm?: string;
}

const ANSWERS_STRING_KEYS: (keyof AnswersFile)[] = ['description', 'author', 'pkgManager', 'apiVersion', 'scm'];
const ANSWERS_ARRAY_KEYS: (keyof AnswersFile)[] = ['db', 'route'];
const ANSWERS_BOOLEAN_KEYS: (keyof AnswersFile)[] = ['react', 'docker', 'k8s', 'apiRoute'];

async function readAnswersFile(path: string, error: (msg: string) => never): Promise<AnswersFile> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch {
    error(`Could not read --answers file: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    error(`--answers file is not valid JSON: ${path}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    error(`--answers file must contain a JSON object: ${path}`);
  }
  const answers = parsed as Record<string, unknown>;

  for (const key of ANSWERS_STRING_KEYS) {
    if (answers[key] !== undefined && typeof answers[key] !== 'string') {
      error(`--answers file: "${key}" must be a string.`);
    }
  }
  for (const key of ANSWERS_ARRAY_KEYS) {
    const value = answers[key];
    if (value !== undefined && (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))) {
      error(`--answers file: "${key}" must be an array of strings.`);
    }
  }
  for (const key of ANSWERS_BOOLEAN_KEYS) {
    if (answers[key] !== undefined && typeof answers[key] !== 'boolean') {
      error(`--answers file: "${key}" must be a boolean.`);
    }
  }

  return answers;
}

function validateEnumValue(value: string, allowed: string[], label: string, error: (msg: string) => never): string {
  if (!allowed.includes(value)) {
    error(`Invalid ${label} "${value}". Must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

function validateEnumList(values: string[], allowed: string[], label: string, error: (msg: string) => never): string[] {
  const invalid = values.filter((v) => !allowed.includes(v));
  if (invalid.length > 0) {
    error(`Invalid ${label}${invalid.length > 1 ? 's' : ''} "${invalid.join(', ')}". Must be one of: ${allowed.join(', ')}`);
  }
  return values;
}

export default class GenerateServer extends Command {
  static override args = {
    name: Args.string({ description: 'Name of the new server project (also used as the output directory name).', required: true }),
  };

  static override description = 'Generate a new RapidREST server project from the built-in template.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> my-api',
    '<%= config.bin %> <%= command.id %> my-api --output-dir ~/projects/my-api',
  ];

  static override flags = {
    force: Flags.boolean({ description: 'Overwrite existing files.' }),
    author: Flags.string({ char: 'a', description: 'The author to attribute the resulting source code to.' }),
    'output-dir': Flags.string({ description: 'Directory to write the generated project into. Defaults to ./<name>.' }),
    answers: Flags.string({ description: 'Path to a JSON file supplying answers for any of the flags below, for reuse across projects. Flags always take precedence over the file; either takes precedence over the interactive prompts.' }),
    description: Flags.string({ description: 'Short description of the project.' }),
    'pkg-manager': Flags.string({ description: `The Node.js package manager to use. One of: ${PKG_MANAGERS.join(', ')}` }),
    db: Flags.string({ multiple: true, description: `A database feature to enable. One of: ${DB_FEATURES.join(', ')}. Repeatable.` }),
    route: Flags.string({ multiple: true, description: `A default route to include. One of: ${ROUTE_TYPES.join(', ')}. Repeatable.` }),
    react: Flags.boolean({ allowNo: true, description: 'Include React frontend support.' }),
    docker: Flags.boolean({ allowNo: true, description: 'Include Docker support.' }),
    k8s: Flags.boolean({ allowNo: true, description: 'Include Kubernetes (Helm) support.' }),
    'api-route': Flags.boolean({ allowNo: true, description: 'Prefix all non-React routes with `/api`.' }),
    'api-version': Flags.string({ description: 'API version to prefix routes with when --api-route is set (e.g. "1" for /api/v1). Leave unset for no version segment.' }),
    scm: Flags.string({ description: `Source control manager. One of: ${SCM_CHOICES.join(', ')} ("none" for no SCM).` }),
    'no-install': Flags.boolean({ description: 'Skip running the package manager install after generating.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateServer);
    const outputDir = flags['output-dir'] ?? join(process.cwd(), args.name);
    const error = (msg: string): never => this.error(msg);

    this.log(`Generating RapidREST server project: "${args.name}"...\n`);

    const answers = flags.answers ? await readAnswersFile(flags.answers, error) : {};

    const description = flags.description ?? answers.description ?? await input({
      message: 'Enter a short project description:',
      required: true,
    });

    const author = flags.author ?? answers.author ?? (await inputAuthor());

    const pkgMgrFlag = flags['pkg-manager'] ?? answers.pkgManager;
    const pkgMgr = pkgMgrFlag
      ? validateEnumValue(pkgMgrFlag, PKG_MANAGERS, 'package manager', error)
      : await select<'npm' | 'yarn'>({
          message: 'Select a package manager:',
          choices: [
            { name: 'yarn', value: 'yarn' },
            { name: 'npm', value: 'npm' },
          ],
        });

    const dbFlag = (flags.db && flags.db.length > 0) ? flags.db : answers.db;
    const dbFeatures = dbFlag
      ? validateEnumList(dbFlag, DB_FEATURES, 'database feature', error)
      : await checkbox<string>({
          message: 'Select the databases you will be using:',
          choices: [
            { name: 'MongoDB', value: 'mongodb', checked: true },
            { name: 'PostgreSQL', value: 'postgresql' },
            { name: 'Redis (cache)', value: 'redis', checked: true, description: 'Required for cache support.' },
            { name: 'SQLite', value: 'sqlite' },
          ],
        });

    // These four flags collectively replace one combined checkbox prompt below — if any of them
    // (or their --answers equivalents) is present, the whole checkbox is skipped and every other
    // member of the group falls back to that checkbox's own default rather than prompting for just
    // the parts not explicitly given (there's no clean way to "resume" part of a checkbox).
    const hasFeatureFlags = [flags.route, flags.react, flags.docker, flags.k8s].some((v) => v !== undefined)
      || [answers.route, answers.react, answers.docker, answers.k8s].some((v) => v !== undefined);

    let routeTypes: string[];
    let hasReact: boolean;
    let hasDocker: boolean;
    let hasK8s: boolean;

    if (hasFeatureFlags) {
      const routeFlag = (flags.route && flags.route.length > 0) ? flags.route : answers.route;
      routeTypes = routeFlag ? validateEnumList(routeFlag, ROUTE_TYPES, 'route type', error) : [];
      hasReact = flags.react ?? answers.react ?? false;
      hasDocker = flags.docker ?? answers.docker ?? true;
      hasK8s = flags.k8s ?? answers.k8s ?? false;
    } else {
      const otherFeatures = await checkbox<string>({
        message: 'Select additional features:',
        choices: [
          new Separator('-- Default Routes --'),
          { name: 'Access Control Lists (RBAC)', value: 'route-acl', checked: true },
          { name: 'Admin', value: 'route-admin', checked: true },
          { name: 'Metrics (Prometheus)', value: 'route-metrics', checked: true },
          { name: 'OpenAPI', value: 'route-openapi', checked: true },
          { name: 'Push', value: 'route-push', checked: true },
          { name: 'Status', value: 'route-status', checked: true },
          new Separator('-- Frontend --'),
          { name: 'React', value: 'react' },
          new Separator('-- Deployment --'),
          { name: 'Docker', value: 'docker', checked: true },
          { name: 'Kubernetes (Helm)', value: 'k8s' },
          // new Separator('-- Desktop --'),
          // { name: 'Electron', value: 'electron' },
        ],
      });
      routeTypes = otherFeatures
        .filter((feature) => feature.startsWith('route-'))
        .map((feature) => feature.substring(6));
      hasReact = otherFeatures.includes('react');
      hasDocker = otherFeatures.includes('docker');
      hasK8s = otherFeatures.includes('k8s');
    }

    const apiRouteFlag = flags['api-route'] ?? answers.apiRoute;
    let apiRoute: boolean;
    let apiVersion: string | undefined;
    if (apiRouteFlag !== undefined) {
      apiRoute = apiRouteFlag;
      apiVersion = apiRoute ? (flags['api-version'] ?? answers.apiVersion ?? '') : undefined;
    } else {
      apiRoute = await confirm({ message: "Would you like to prefix all non-React routes with `/api` ?" });
      apiVersion = apiRoute
        ? await input({ message: 'Enter the API version (enter blank for no version prefix):', default: '1', required: false })
        : undefined;
    }

    const scmFlag = flags.scm ?? answers.scm;
    const scmChoice = scmFlag !== undefined
      ? (validateEnumValue(scmFlag, SCM_CHOICES, 'SCM', error) === 'none' ? '' : scmFlag)
      : await select<string>({
          message: 'Select your Source Control Manager (SCM):',
          choices: [
            { name: 'GitHub', value: 'github' },
            { name: 'GitLab', value: 'gitlab' },
            { name: 'Git (local)', value: 'git' },
            { name: 'Perforce (Helix)', value: 'p4' },
            { name: 'Subversion', value: 'svn' },
            { name: '(none)', value: '' },
          ],
        });

    const allFeatures = [...dbFeatures, ...(hasReact ? ['react'] : []), ...(hasDocker ? ['docker'] : []), ...(hasK8s ? ['k8s'] : [])];

    const context: Record<string, unknown> = {
      apiRoute,
      apiVersion,
      author,
      description,
      features: {
        mongodb: allFeatures.includes('mongodb'),
        postgresql: allFeatures.includes('postgresql'),
        redis: allFeatures.includes('redis'),
        sqlite: allFeatures.includes('sqlite'),
        docker: hasDocker,
        react: hasReact,
        electron: false,
        k8s: hasK8s,
        hasDatabase: allFeatures.includes('mongodb') || allFeatures.includes('postgresql') || allFeatures.includes('sqlite'),
        // TypeORM (and its `typeorm` dependency) backs both the postgresql and sqlite datastore
        // types, so package.json gates it on this combined flag rather than duplicating a
        // "typeorm" entry under two separate {{#if}} blocks — which would produce a duplicate
        // JSON key if a project selects both (dbFeatures is a multi-select checkbox).
        hasSqlDatastore: allFeatures.includes('postgresql') || allFeatures.includes('sqlite'),
      },
      pkgMgr: {
        npm: pkgMgr === 'npm',
        yarn: pkgMgr === 'yarn',
      },
      project_name: args.name,
      repository: `${scmChoice}/${args.name}`,
      scm: {
        git: scmChoice === 'git' || scmChoice === 'github' || scmChoice === 'gitlab',
        github: scmChoice === 'github',
        gitlab: scmChoice === 'gitlab',
        p4: scmChoice === 'p4',
        svn: scmChoice === 'svn',
      },
      year: new Date().getFullYear(),
    };

    const templateDir = join(this.config.root, 'templates', 'server');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force });

      if (routeTypes.length > 0) {
        this.log(`\nAdding default routes: ${routeTypes.join(', ')}...`);
        await GenerateDefaultRoute.run([
          '--output-dir', outputDir,
          '--author', author,
          ...routeTypes.flatMap((type) => ['--type', type]),
          ...(flags.force ? ['--force'] : []),
          // apiRoute was already fully resolved above (flag, --answers file, or the prompt right
          // here in this command) — always pass an explicit --api-route/--no-api-route rather than
          // just omitting it when false, so default-route.ts never falls through to its own
          // "Is this an API route?" prompt and silently blocks a non-interactive run.
          ...(apiRoute ? ['--api-route', '--api', apiVersion ?? ''] : ['--no-api-route']),
        ], this.config.root);
      }

      if (hasDocker) {
        this.log('\nAdding Docker support...');
        await GenerateDocker.run([
          '--output-dir', outputDir,
          ...(flags.force ? ['--force'] : []),
          // Explicit, not left to GenerateDocker's own filesystem detection: this runs before React
          // generation below, so detectReact(cwd) would see no vite.config.ts yet even when --react
          // was requested for this same scaffold.
          hasReact ? '--has-react' : '--no-has-react',
        ], this.config.root);
      }

      if (hasK8s) {
        this.log('\nAdding Kubernetes (Helm) support...');
        await GenerateHelm.run([
          '--output-dir', outputDir,
          ...(flags.force ? ['--force'] : []),
          '--no-install',
        ], this.config.root);
      }

      if (hasReact) {
        this.log('\nAdding React support...');
        await GenerateReact.run([
          'app',
          '--output-dir', outputDir,
          ...(flags.force ? ['--force'] : []),
          '--no-install',
        ], this.config.root);
      }

      // Covers dependencies added by this scaffold plus every nested step above (k8s/react were
      // told --no-install so this is the only install for the whole `generate server` run).
      if (!flags['no-install']) {
        await installIfPackageJsonChanged(outputDir, undefined, (m) => this.log(m), (m) => this.warn(m));
      }

      this.log(`\nProject "${args.name}" generated at: ${outputDir}`);
      this.log(`\nNext steps:`);
      this.log(`  cd ${args.name}`);
      if (flags['no-install']) {
        this.log(`  ${pkgMgr} install`);
      }
      this.log(`  ${pkgMgr} run build`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
