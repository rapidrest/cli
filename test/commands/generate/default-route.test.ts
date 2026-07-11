import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  confirm: vi.fn(),
  checkbox: vi.fn(),
}));

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  readProjectDatastores: vi.fn(),
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

import { input, confirm, checkbox } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { readProjectDatastores } from '../../../src/lib/project.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import GenerateDefaultRoute from '../../../src/commands/generate/default-route.js';

const ROOT = process.cwd();

// Default prompt order when --type is omitted (the normal case):
//   inputAuthor() → confirm(isApi) → [input(apiVersion)] → checkbox(routes)
function stubPrompts({
  author,
  isApi = false,
  apiVersion = '1',
  routes = ['acl-route', 'admin-route', 'metrics-route', 'openapi-route', 'push-route', 'status-route'],
}: {
  author?: string;
  isApi?: boolean;
  apiVersion?: string;
  routes?: string[];
} = {}) {
  if (author !== undefined) vi.mocked(inputAuthor).mockResolvedValueOnce(author);
  vi.mocked(confirm).mockResolvedValueOnce(isApi);
  if (isApi) {
    vi.mocked(input).mockResolvedValueOnce(apiVersion);
  }
  vi.mocked(checkbox).mockResolvedValueOnce(routes);
}

describe('generate default-route', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(inputAuthor).mockResolvedValue('Default Author');
    vi.mocked(readProjectDatastores).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('context building', () => {
    it('builds the correct context from prompts and passes it to processTemplate', async () => {
      stubPrompts({ author: 'Alice', routes: ['acl-route', 'status-route'] });

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/routes'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        author: 'Alice',
        year: new Date().getFullYear(),
        apiRoute: false,
        apiVersion: undefined,
        hasACLRoute: true,
        hasAdminRoute: false,
        hasMetricsRoute: false,
        hasOpenAPIRoute: false,
        hasPushRoute: false,
        hasStatusRoute: true,
      });
    });

    it('sets hasXRoute flags to true only for the routes selected via checkbox', async () => {
      stubPrompts({ author: 'Author', routes: ['metrics-route', 'push-route'] });
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        hasACLRoute: false,
        hasAdminRoute: false,
        hasMetricsRoute: true,
        hasOpenAPIRoute: false,
        hasPushRoute: true,
        hasStatusRoute: false,
      });
    });

    it('sets hasStaticRoute: true when static-route is selected via checkbox', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
      vi.mocked(confirm).mockResolvedValueOnce(false); // isApi
      vi.mocked(checkbox).mockResolvedValueOnce(['static-route']);
      vi.mocked(input).mockResolvedValueOnce('public'); // static file path prompt

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hasStaticRoute).toBe(true);
    });
  });

  describe('api flag', () => {
    it('sets apiRoute: false and apiVersion: undefined when the "Is this an API route?" prompt is declined', async () => {
      stubPrompts({ author: 'Author', isApi: false });
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.apiRoute).toBe(false);
      expect(context.apiVersion).toBeUndefined();
    });

    it('sets apiRoute: true and apiVersion from the follow-up prompt when confirmed', async () => {
      stubPrompts({ author: 'Author', isApi: true, apiVersion: '2' });
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.apiRoute).toBe(true);
      expect(context.apiVersion).toBe('2');
    });

    it('--api with a value skips both the confirm and version prompts', async () => {
      vi.mocked(checkbox).mockResolvedValueOnce(['acl-route']);

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--api', '3'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.apiRoute).toBe(true);
      expect(context.apiVersion).toBe('3');
      expect(vi.mocked(confirm)).not.toHaveBeenCalled();
    });
  });

  describe('--type flag', () => {
    it('generates only the specified route type without showing the checkbox prompt', async () => {
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--type', 'admin'], ROOT);

      expect(vi.mocked(checkbox)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        hasACLRoute: false,
        hasAdminRoute: true,
        hasMetricsRoute: false,
        hasOpenAPIRoute: false,
        hasPushRoute: false,
        hasStatusRoute: false,
      });
    });

    it('accepts each of the documented route types', async () => {
      const cases: [string, string][] = [
        ['acl', 'hasACLRoute'],
        ['admin', 'hasAdminRoute'],
        ['metrics', 'hasMetricsRoute'],
        ['openapi', 'hasOpenAPIRoute'],
        ['push', 'hasPushRoute'],
        ['static', 'hasStaticRoute'],
        ['status', 'hasStatusRoute'],
      ];
      for (const [type, flagName] of cases) {
        vi.clearAllMocks();
        vi.mocked(processTemplate).mockResolvedValue(undefined);
        vi.mocked(inputAuthor).mockResolvedValue('Default Author');
        vi.mocked(readProjectDatastores).mockResolvedValue([]);
        // 'static' triggers an extra interactive prompt for the static file path
        // when --static-path isn't also provided.
        if (type === 'static') {
          vi.mocked(input).mockResolvedValueOnce('public');
        }

        await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--type', type], ROOT);

        const [, , context] = vi.mocked(processTemplate).mock.calls[0];
        expect((context as Record<string, boolean>)[flagName]).toBe(true);
      }
    });

    it('rejects an unrecognized --type value', async () => {
      await expect(
        GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--type', 'bogus'], ROOT),
      ).rejects.toThrow();

      expect(processTemplate).not.toHaveBeenCalled();
    });

    it('generates multiple route types when --type is passed more than once', async () => {
      await GenerateDefaultRoute.run(
        ['--output-dir', '/tmp/m', '--type', 'acl', '--type', 'admin', '--type', 'status'],
        ROOT,
      );

      expect(vi.mocked(checkbox)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        hasACLRoute: true,
        hasAdminRoute: true,
        hasMetricsRoute: false,
        hasOpenAPIRoute: false,
        hasPushRoute: false,
        hasStatusRoute: true,
      });
    });

    it('dedupes repeated --type values', async () => {
      await GenerateDefaultRoute.run(
        ['--output-dir', '/tmp/m', '--type', 'acl', '--type', 'acl'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hasACLRoute).toBe(true);
    });

    it('rejects when any of multiple --type values is invalid, listing all invalid ones', async () => {
      await expect(
        GenerateDefaultRoute.run(
          ['--output-dir', '/tmp/m', '--type', 'acl', '--type', 'bogus', '--type', 'nope'],
          ROOT,
        ),
      ).rejects.toThrow(/bogus, nope/);

      expect(processTemplate).not.toHaveBeenCalled();
    });
  });

  describe('static route type', () => {
    it('prompts for the static file path when static-route is selected via checkbox and --static-path is not provided', async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false); // isApi
      vi.mocked(checkbox).mockResolvedValueOnce(['static-route']);
      vi.mocked(input).mockResolvedValueOnce('assets');

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m'], ROOT);

      expect(vi.mocked(input)).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Enter the path containing the static files to serve:' }),
      );
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.staticPath).toBe('assets');
    });

    it('does not prompt for the static file path when static-route is not selected', async () => {
      stubPrompts({ author: 'Author', routes: ['acl-route'] });
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m'], ROOT);

      expect(vi.mocked(input)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.staticPath).toBe('public');
    });

    it('--static-path skips the interactive prompt and uses the flag value', async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false); // isApi
      vi.mocked(checkbox).mockResolvedValueOnce(['static-route']);

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--static-path', 'wwwroot'], ROOT);

      expect(vi.mocked(input)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.staticPath).toBe('wwwroot');
    });

    it('--type static without --static-path still prompts for the path interactively', async () => {
      vi.mocked(input).mockResolvedValueOnce('assets');

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--type', 'static'], ROOT);

      expect(vi.mocked(checkbox)).not.toHaveBeenCalled();
      expect(vi.mocked(input)).toHaveBeenCalledOnce();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.staticPath).toBe('assets');
    });

    it('--type static --static-path is fully non-interactive', async () => {
      await GenerateDefaultRoute.run(
        ['--output-dir', '/tmp/m', '--type', 'static', '--static-path', 'assets', '--author', 'Author', '--api', '1'],
        ROOT,
      );

      expect(vi.mocked(checkbox)).not.toHaveBeenCalled();
      expect(vi.mocked(input)).not.toHaveBeenCalled();
      expect(vi.mocked(confirm)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.staticPath).toBe('assets');
      expect(context.hasStaticRoute).toBe(true);
    });

    it('defaults staticPath to "public" in the context even when static-route is not part of the selection', async () => {
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--type', 'admin'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.staticPath).toBe('public');
      expect(context.hasStaticRoute).toBe(false);
    });
  });

  describe('mongodb detection for the ACL route', () => {
    it('sets features.mongodb to false when the project has no mongodb datastore', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'sql', type: 'postgres' }]);

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--type', 'acl'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context.features as Record<string, boolean>).mongodb).toBe(false);
    });

    it('sets features.mongodb to true when the project has a mongodb datastore', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'acl', type: 'mongodb' }]);

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--type', 'acl'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context.features as Record<string, boolean>).mongodb).toBe(true);
    });

    it('reads datastores from the current working directory', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([]);
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--type', 'acl'], ROOT);

      expect(readProjectDatastores).toHaveBeenCalledWith(process.cwd());
    });
  });

  describe('author resolution', () => {
    it('uses the --author flag and skips inputAuthor entirely', async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false);
      vi.mocked(checkbox).mockResolvedValueOnce(['acl-route']);

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
    });

    it('calls inputAuthor with the project cwd and uses its return value', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author <git@example.com>');
      stubPrompts();

      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author <git@example.com>');
      expect(inputAuthor).toHaveBeenCalledWith(process.cwd());
    });
  });

  describe('output and template options', () => {
    it('uses process.cwd() as the default output directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateDefaultRoute.run([], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(process.cwd());
    });

    it('uses --output-dir when provided', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe('/tmp/m');
    });

    it('passes force: true to processTemplate when --force is set', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m', '--force'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: true });
    });

    it('points processTemplate at the default-route template directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateDefaultRoute.run(['--output-dir', '/tmp/m'], ROOT);

      const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(templateDir).toContain(join('templates', 'default-route'));
    });
  });
});
