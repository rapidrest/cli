import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  checkbox: vi.fn(),
  Separator: class {
    separator: string;
    constructor(separator: string) { this.separator = separator; }
  },
}));

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  readGitAuthor: vi.fn(),
  readProjectAuthor: vi.fn(),
  readProjectModels: vi.fn(),
  readModelDatastore: vi.fn(),
  readProjectDatastores: vi.fn(),
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

vi.mock('../../../src/commands/generate/model.js', () => ({
  default: { run: vi.fn() },
}));

import { input, select, confirm } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import {
  readProjectModels,
  readModelDatastore,
  readProjectDatastores,
} from '../../../src/lib/project.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import GenerateModel from '../../../src/commands/generate/model.js';
import GenerateRoute from '../../../src/commands/generate/route.js';

const ROOT = process.cwd();

// Default prompt order when project models are found (the normal case):
//   input(description) → input(path) → confirm(isApi) → [input(apiVersion)]
//   → select(model) → confirm(protect) → inputAuthor(cwd)
// readModelDatastore returns 'acl' by default; readProjectDatastores maps 'acl' → 'mongodb'.
function stubPrompts({
  description = 'Handles products',
  path = '/api/v1/products',
  isApi = false,
  apiVersion = '1',
  model = 'Product',
  protect = false,
  author,
}: {
  description?: string;
  path?: string;
  isApi?: boolean;
  apiVersion?: string;
  model?: string;
  protect?: boolean;
  author?: string;
} = {}) {
  vi.mocked(input).mockResolvedValueOnce(description).mockResolvedValueOnce(path);
  vi.mocked(confirm).mockResolvedValueOnce(isApi);
  if (isApi) {
    vi.mocked(input).mockResolvedValueOnce(apiVersion);
  }
  vi.mocked(select).mockResolvedValueOnce(model);
  vi.mocked(confirm).mockResolvedValueOnce(protect);
  if (author !== undefined) vi.mocked(inputAuthor).mockResolvedValueOnce(author);
}

describe('generate route', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(inputAuthor).mockResolvedValue('Default Author');
    vi.mocked(readProjectModels).mockResolvedValue(['Product', 'User']);
    vi.mocked(readModelDatastore).mockResolvedValue('acl');
    vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'acl', type: 'mongodb' }]);
    (GenerateModel as any).run.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('context building', () => {
    it('builds the correct context from prompts and passes it to processTemplate', async () => {
      stubPrompts({ description: 'Manages orders', path: '/api/v1/orders', model: 'Order', protect: true, author: 'Alice' });
      vi.mocked(readModelDatastore).mockResolvedValue('orders');
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'orders', type: 'postgres' }]);

      await GenerateRoute.run(['OrderRoute', '--output-dir', '/tmp/routes'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        name: 'OrderRoute',
        description: 'Manages orders',
        path: '/api/v1/orders',
        model: 'Order',
        datastore: 'orders',
        datastoreType: 'postgres',
        protect: true,
        author: 'Alice',
        apiRoute: false,
        apiVersion: undefined,
        year: new Date().getFullYear(),
      });
    });

    it('resolves datastoreType from the model\'s @DataStore decorator via the project config', async () => {
      stubPrompts({ model: 'Product', author: 'Author' });

      await GenerateRoute.run(['ProductRoute'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('acl');
      expect(context.datastoreType).toBe('mongodb');
      expect(readModelDatastore).toHaveBeenCalledWith(expect.any(String), 'Product');
    });

    it('leaves datastoreType empty when the model\'s datastore is not in the project config', async () => {
      vi.mocked(readModelDatastore).mockResolvedValue('orphan');
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'acl', type: 'mongodb' }]);
      stubPrompts({ model: 'Product', author: 'Author' });

      await GenerateRoute.run(['ProductRoute'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('orphan');
      expect(context.datastoreType).toBe('');
    });

    it('sets hasRedis true when a redis datastore is configured alongside the model datastore', async () => {
      vi.mocked(readModelDatastore).mockResolvedValue('acl');
      vi.mocked(readProjectDatastores).mockResolvedValue([
        { name: 'acl', type: 'mongodb' },
        { name: 'cache', type: 'redis' },
      ]);
      stubPrompts({ model: 'Product', author: 'Author' });

      await GenerateRoute.run(['ProductRoute'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hasRedis).toBe(true);
    });

    it('sets datastore and datastoreType to empty when model is "(none)"', async () => {
      stubPrompts({ model: '', author: 'Author' }); // '' = (none) option

      await GenerateRoute.run(['ProductRoute'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.model).toBe('');
      expect(context.datastore).toBe('');
      expect(context.datastoreType).toBe('');
      expect(readModelDatastore).not.toHaveBeenCalled();
    });

    it('leaves datastoreType empty when the model has no @DataStore decorator', async () => {
      vi.mocked(readModelDatastore).mockResolvedValue('');
      stubPrompts({ model: 'Product', author: 'Author' });

      await GenerateRoute.run(['ProductRoute'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('');
      expect(context.datastoreType).toBe('');
      expect(readProjectDatastores).not.toHaveBeenCalled();
    });
  });

  describe('api flag', () => {
    it('sets apiRoute: false and apiVersion: undefined when the "Is this an API route?" prompt is declined', async () => {
      stubPrompts({ isApi: false, author: 'Author' });
      await GenerateRoute.run(['ProductRoute'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.apiRoute).toBe(false);
      expect(context.apiVersion).toBeUndefined();
    });

    it('sets apiRoute: true and apiVersion from the follow-up prompt when confirmed', async () => {
      stubPrompts({ isApi: true, apiVersion: '2', author: 'Author' });
      await GenerateRoute.run(['ProductRoute'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.apiRoute).toBe(true);
      expect(context.apiVersion).toBe('2');
    });

    it('--api with a value skips both the confirm and version prompts', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('/api/v1/x');
      vi.mocked(select).mockResolvedValueOnce('Product');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect only

      await GenerateRoute.run(['ProductRoute', '--api', '3'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.apiRoute).toBe(true);
      expect(context.apiVersion).toBe('3');
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1); // protect only, no "Is this an API route?" prompt
    });

    it('--api with an empty string still triggers the "Is this an API route?" prompt, but apiRoute stays true since the flag was passed', async () => {
      // '' is falsy, so the `!api` guard still fires the confirm prompt — but api itself
      // remains '' (not undefined) when the confirm is declined, so apiRoute is still true.
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('/api/v1/x');
      vi.mocked(select).mockResolvedValueOnce('Product');
      vi.mocked(confirm)
        .mockResolvedValueOnce(false) // isApi → declined
        .mockResolvedValueOnce(false); // protect

      await GenerateRoute.run(['ProductRoute', '--api', ''], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.apiRoute).toBe(true);
      expect(context.apiVersion).toBe('');
      expect(vi.mocked(confirm)).toHaveBeenCalledWith(expect.objectContaining({ message: 'Is this an API route?' }));
    });
  });

  describe('model selection', () => {
    it('shows a select with "(none)", project models, and a "+ New model..." option', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateRoute.run(['ProductRoute'], ROOT);

      const firstSelectCall = vi.mocked(select).mock.calls[0][0] as any;
      expect(firstSelectCall.choices).toEqual(
        expect.arrayContaining([
          { name: '(none)', value: '' },
          { name: 'Product', value: 'Product' },
          { name: 'User', value: 'User' },
          { name: '+ New model...', value: '__new__' },
        ]),
      );
    });

    it('runs generate model inline when "+ New model..." is selected and uses the newly created model', async () => {
      // readProjectModels is called three times: choices, "before" snapshot, "after" generation
      vi.mocked(readProjectModels)
        .mockResolvedValueOnce(['Product', 'User'])
        .mockResolvedValueOnce(['Product', 'User'])
        .mockResolvedValueOnce(['Product', 'User', 'Order']);
      vi.mocked(input)
        .mockResolvedValueOnce('A desc')
        .mockResolvedValueOnce('/api/v1/x');
      vi.mocked(confirm).mockResolvedValueOnce(false);         // isApi
      vi.mocked(select).mockResolvedValueOnce('__new__');      // model select
      vi.mocked(confirm).mockResolvedValueOnce(false);         // protect

      await GenerateRoute.run(['OrderRoute'], ROOT);

      expect((GenerateModel as any).run).toHaveBeenCalledOnce();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.model).toBe('Order');
      expect(context.datastore).toBe('acl');
      expect(context.datastoreType).toBe('mongodb');
    });

    it('falls back to an empty model name when no new model is detected after generate model runs', async () => {
      // "before" and "after" snapshots are identical — no new model can be detected
      vi.mocked(readProjectModels).mockResolvedValue(['Product', 'User']);
      vi.mocked(input)
        .mockResolvedValueOnce('A desc')
        .mockResolvedValueOnce('/api/v1/x');
      vi.mocked(confirm).mockResolvedValueOnce(false);         // isApi
      vi.mocked(select).mockResolvedValueOnce('__new__');      // model select
      vi.mocked(confirm).mockResolvedValueOnce(false);         // protect

      await GenerateRoute.run(['OrderRoute'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.model).toBe('');
    });

    it('falls back to a free-form input when no models exist in the project', async () => {
      vi.mocked(readProjectModels).mockResolvedValue([]);
      // With no models: input order becomes description → path → model (free-form)
      vi.mocked(input)
        .mockResolvedValueOnce('A desc')
        .mockResolvedValueOnce('/api/v1/x')
        .mockResolvedValueOnce(''); // model (free-form)
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // isApi
        .mockResolvedValueOnce(false); // protect

      await GenerateRoute.run(['ProductRoute'], ROOT);

      expect(vi.mocked(input)).toHaveBeenCalledTimes(3);
      expect(vi.mocked(select)).not.toHaveBeenCalled(); // no model select, protect is confirm
    });

    it('--no-model skips all model prompts and leaves model undefined in context', async () => {
      vi.mocked(input)
        .mockResolvedValueOnce('A desc')
        .mockResolvedValueOnce('/api/v1/x');
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // isApi
        .mockResolvedValueOnce(false); // protect

      await GenerateRoute.run(['OrderRoute', '--no-model'], ROOT);

      expect(readProjectModels).not.toHaveBeenCalled();
      expect(readModelDatastore).not.toHaveBeenCalled();
      expect(vi.mocked(select)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.model).toBeUndefined();
      expect(context.datastore).toBe('');
      expect(context.datastoreType).toBe('');
    });
  });

  describe('flag shortcuts bypass prompts', () => {
    it('--model skips the model select and resolves datastore from the named model file', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('/api/v1/x');
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // isApi
        .mockResolvedValueOnce(false); // protect

      await GenerateRoute.run(['OrderRoute', '--model', 'Product'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.model).toBe('Product');
      expect(context.datastore).toBe('acl');
      expect(context.datastoreType).toBe('mongodb');
      expect(readProjectModels).not.toHaveBeenCalled();
      expect(readModelDatastore).toHaveBeenCalledWith(expect.any(String), 'Product');
      expect(vi.mocked(select)).not.toHaveBeenCalled(); // no model select (from flag), protect is confirm
    });

    it('--description skips the description input prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('/api/v1/x');
      vi.mocked(confirm).mockResolvedValueOnce(false); // isApi
      vi.mocked(select).mockResolvedValueOnce('Product');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await GenerateRoute.run(['OrderRoute', '--description', 'From flag'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.description).toBe('From flag');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // path only
    });

    it('--path skips the route path input prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(confirm).mockResolvedValueOnce(false); // isApi
      vi.mocked(select).mockResolvedValueOnce('Product');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await GenerateRoute.run(['OrderRoute', '--path', '/api/v2/orders'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.path).toBe('/api/v2/orders');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // description only
    });

    it('--protect skips the protect confirm prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('/api/v1/x');
      vi.mocked(confirm).mockResolvedValueOnce(false); // isApi
      vi.mocked(select).mockResolvedValueOnce('Product'); // model only

      await GenerateRoute.run(['OrderRoute', '--protect'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.protect).toBe(true);
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1); // isApi only, no protect confirm
      expect(vi.mocked(select)).toHaveBeenCalledTimes(1); // model only
    });

    it('--author skips inputAuthor entirely', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('/api/v1/x');
      vi.mocked(confirm).mockResolvedValueOnce(false); // isApi
      vi.mocked(select).mockResolvedValueOnce('Product');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await GenerateRoute.run(['OrderRoute', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + path only
    });
  });

  describe('author resolution', () => {
    it('calls inputAuthor with the project cwd and uses its return value', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author <git@example.com>');
      stubPrompts();

      await GenerateRoute.run(['OrderRoute', '--output-dir', '/tmp/routes'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author <git@example.com>');
      expect(inputAuthor).toHaveBeenCalledWith(process.cwd());
    });
  });

  describe('output and template options', () => {
    it('uses project root as the default output directory for the route file', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateRoute.run(['ProductRoute'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(ROOT);
    });

    it('passes force: true to both processTemplate calls when --force is set', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateRoute.run(['ProductRoute', '--output-dir', '/tmp/routes', '--force'], ROOT);

      for (const call of vi.mocked(processTemplate).mock.calls) {
        expect(call[3]).toMatchObject({ force: true });
      }
    });
  });

  describe('error handling', () => {
    it('propagates an error thrown by processTemplate', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue(new Error('template boom'));

      await expect(
        GenerateRoute.run(['OrderRoute', '--output-dir', '/tmp/routes'], ROOT),
      ).rejects.toThrow('template boom');
    });

    it('falls back to String(err) when processTemplate rejects with a non-Error value', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue('non-error-boom');

      await expect(
        GenerateRoute.run(['OrderRoute', '--output-dir', '/tmp/routes'], ROOT),
      ).rejects.toThrow('non-error-boom');
    });
  });
});
