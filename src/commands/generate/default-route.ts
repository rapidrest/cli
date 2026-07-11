import { checkbox, confirm, input } from '@inquirer/prompts';
import { Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { inputAuthor } from '../../lib/prompts.js';
import { readProjectDatastores } from '../../lib/project.js';

const ROUTE_TYPES = ['acl', 'admin', 'metrics', 'openapi', 'push', 'status'];

export default class GenerateDefaultRoute extends Command {
  static override args = {
  };

  static override description = 'Generates one or more RapidREST default route handlers in the current project.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> ProductRoute',
    '<%= config.bin %> <%= command.id %> ProductRoute --output-dir src/routes --no-test',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    api: Flags.string({ description: "Use @ApiRoute instead of @Route for the generated route(s). Pass a value to specify an api version." }),
    author: Flags.string({ alias: 'a', description: 'The author to attribute the resulting source code to.' }),
    'output-dir': Flags.string({ description: 'Directory to write the generated route into. Defaults to ./src/routes.' }),
    type: Flags.string({ alias: 't', multiple: true, description: 'The type of default route to generate: acl, admin, metrics, openapi, push, status. Pass more than once to generate multiple route types.'})
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateDefaultRoute);
    const cwd = process.cwd();
    const outputDir = flags['output-dir'] ?? cwd;

    this.log('Generating default route(s)...\n');

    const author = flags.author ?? (await inputAuthor(cwd));

    let api = flags.api ?? undefined;
    if (!api && await confirm({ message: "Is this an API route?" })) {
      api = await input({
        message: 'Enter the API version (enter blank for no version prefix):',
        default: '1',
        required: false
      });
    }

    let routes: string[];
    if (flags.type && flags.type.length > 0) {
      const invalid = flags.type.filter((t) => !ROUTE_TYPES.includes(t));
      if (invalid.length > 0) {
        this.error(`Invalid route type${invalid.length > 1 ? 's' : ''} "${invalid.join(', ')}". Must be one of: ${ROUTE_TYPES.join(', ')}`);
      }
      routes = [...new Set(flags.type.map((t) => `${t}-route`))];
    } else {
      routes = await checkbox<string>({
        message: 'Select additional features:',
        choices: [
          { name: 'Access Control Lists (RBAC)', value: 'acl-route', checked: true },
          { name: 'Admin', value: 'admin-route', checked: true },
          { name: 'Metrics (Prometheus)', value: 'metrics-route', checked: true },
          { name: 'OpenAPI', value: 'openapi-route', checked: true },
          { name: 'Push', value: 'push-route', checked: true },
          { name: 'Status', value: 'status-route', checked: true },
        ],
      });
    }

    const datastores = await readProjectDatastores(cwd);

    const context: Record<string, unknown> = {
      apiRoute: api !== undefined,
      apiVersion: api,
      author,
      year: new Date().getFullYear(),
      features: {
        mongodb: datastores.some((d) => d.type === 'mongodb'),
      },
      hasACLRoute: routes.includes('acl-route'),
      hasAdminRoute: routes.includes('admin-route'),
      hasMetricsRoute: routes.includes('metrics-route'),
      hasOpenAPIRoute: routes.includes('openapi-route'),
      hasPushRoute: routes.includes('push-route'),
      hasStatusRoute: routes.includes('status-route'),
    };

    const templateDir = join(this.config.root, 'templates', 'default-route');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force, projectDir: process.cwd() });
      for (const route of routes) {
        this.log(`\nRoute "${route}" generated.`);
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
