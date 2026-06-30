import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
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
  readProjectAuthor: vi.fn(),
  readProjectModels: vi.fn(),
  readModelDatastore: vi.fn(),
  readProjectDatastores: vi.fn(),
}));

import { input, select } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import {
  readProjectAuthor,
  readProjectModels,
  readModelDatastore,
  readProjectDatastores,
} from '../../../src/lib/project.js';
import GenerateRoute from '../../../src/commands/generate/route.js';

const ROOT = process.cwd();

// Default prompt order when project models are found (the normal case):
//   input(description) → input(path) → select(model) → select(protect) → input(author)?
// readModelDatastore returns 'acl' by default; readProjectDatastores maps 'acl' → 'mongodb'.
function stubPrompts({
  description = 'Handles products',
  path = '/api/v1/products',
  model = 'Product',
  protect = false,
  author,
}: {
  description?: string;
  path?: string;
  model?: string;
  protect?: boolean;
  author?: string;
} = {}) {
  vi.mocked(input).mockResolvedValueOnce(description).mockResolvedValueOnce(path);
  vi.mocked(select).mockResolvedValueOnce(model as any).mockResolvedValueOnce(protect as any);
  if (author !== undefined) vi.mocked(input).mockResolvedValueOnce(author);
}

describe('generate route', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(readProjectAuthor).mockResolvedValue(undefined);
    vi.mocked(readProjectModels).mockResolvedValue(['Product', 'User']);
    vi.mocked(readModelDatastore).mockResolvedValue('acl');
    vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'acl', type: 'mongodb' }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('context building', () => {
    it('builds the correct context from prompts and passes it to processTemplate', async () => {
      stubPrompts({ description: 'Manages orders', path: '/api/v1/orders', model: 'Order', protect: true, author: 'Alice' });
      vi.mocked(readModelDatastore).mockResolvedValue('orders');
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'orders', type: 'postgres' }]);

      await GenerateRoute.run(['OrderRoute', '--output-dir', '/tmp/routes', '--no-test'], ROOT);

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
        year: new Date().getFullYear(),
      });
    });

    it('resolves datastoreType from the model\'s @DataStore decorator via the project config', async () => {
      stubPrompts({ model: 'Product', author: 'Author' });

      await GenerateRoute.run(['ProductRoute', '--no-test'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('acl');
      expect(context.datastoreType).toBe('mongodb');
      expect(readModelDatastore).toHaveBeenCalledWith(expect.any(String), 'Product');
    });

    it('sets datastore and datastoreType to empty when model is "(none)"', async () => {
      stubPrompts({ model: '', author: 'Author' }); // '' = (none) option

      await GenerateRoute.run(['ProductRoute', '--no-test'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.model).toBe('');
      expect(context.datastore).toBe('');
      expect(context.datastoreType).toBe('');
      expect(readModelDatastore).not.toHaveBeenCalled();
    });

    it('leaves datastoreType empty when the model has no @DataStore decorator', async () => {
      vi.mocked(readModelDatastore).mockResolvedValue('');
      stubPrompts({ model: 'Product', author: 'Author' });

      await GenerateRoute.run(['ProductRoute', '--no-test'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('');
      expect(context.datastoreType).toBe('');
      expect(readProjectDatastores).not.toHaveBeenCalled();
    });
  });

  describe('model selection', () => {
    it('shows a select with "(none)" plus all project model names', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateRoute.run(['ProductRoute', '--no-test'], ROOT);

      const firstSelectCall = vi.mocked(select).mock.calls[0][0] as any;
      expect(firstSelectCall.choices).toEqual([
        { name: '(none)', value: '' },
        { name: 'Product', value: 'Product' },
        { name: 'User', value: 'User' },
      ]);
    });

    it('falls back to a free-form input when no models exist in the project', async () => {
      vi.mocked(readProjectModels).mockResolvedValue([]);
      // With no models: input order becomes description → path → model → [author]
      vi.mocked(input)
        .mockResolvedValueOnce('A desc')
        .mockResolvedValueOnce('/api/v1/x')
        .mockResolvedValueOnce('') // model (free-form)
        .mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce(false as any); // protect

      await GenerateRoute.run(['ProductRoute', '--no-test'], ROOT);

      expect(vi.mocked(input)).toHaveBeenCalledTimes(4);
      expect(vi.mocked(select)).toHaveBeenCalledTimes(1); // protect only (no model select)
    });
  });

  describe('flag shortcuts bypass prompts', () => {
    it('--model skips the model select and resolves datastore from the named model file', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('/api/v1/x').mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce(false as any); // protect only

      await GenerateRoute.run(['OrderRoute', '--no-test', '--model', 'Product'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.model).toBe('Product');
      expect(context.datastore).toBe('acl');
      expect(context.datastoreType).toBe('mongodb');
      expect(readProjectModels).not.toHaveBeenCalled();
      expect(readModelDatastore).toHaveBeenCalledWith(expect.any(String), 'Product');
      expect(vi.mocked(select)).toHaveBeenCalledTimes(1); // protect only
    });

    it('--description skips the description input prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('/api/v1/x').mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce('Product' as any).mockResolvedValueOnce(false as any);

      await GenerateRoute.run(['OrderRoute', '--no-test', '--description', 'From flag'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.description).toBe('From flag');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // path + author
    });

    it('--path skips the route path input prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce('Product' as any).mockResolvedValueOnce(false as any);

      await GenerateRoute.run(['OrderRoute', '--no-test', '--path', '/api/v2/orders'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.path).toBe('/api/v2/orders');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + author
    });

    it('--protect skips the protect select prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('/api/v1/x').mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce('Product' as any); // model only

      await GenerateRoute.run(['OrderRoute', '--no-test', '--protect'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.protect).toBe(true);
      expect(vi.mocked(select)).toHaveBeenCalledTimes(1); // model only
    });

    it('--author skips all author resolution', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('/api/v1/x');
      vi.mocked(select).mockResolvedValueOnce('Product' as any).mockResolvedValueOnce(false as any);

      await GenerateRoute.run(['OrderRoute', '--no-test', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(readProjectAuthor).not.toHaveBeenCalled();
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + path only
    });
  });

  describe('author resolution priority', () => {
    it('uses package.json author without prompting when no --author flag', async () => {
      vi.mocked(readProjectAuthor).mockResolvedValue('Package Author');
      stubPrompts(); // no author arg — author prompt should not fire

      await GenerateRoute.run(['OrderRoute', '--output-dir', '/tmp/routes', '--no-test'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Package Author');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + path only
    });

    it('falls back to the author input prompt when package.json has no author', async () => {
      stubPrompts({ author: 'Prompted Author' });

      await GenerateRoute.run(['OrderRoute', '--output-dir', '/tmp/routes', '--no-test'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Prompted Author');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(3); // description + path + author
    });
  });

  describe('test file generation', () => {
    it('calls processTemplate twice by default (route file + test file)', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateRoute.run(['ProductRoute', '--output-dir', '/tmp/routes'], ROOT);

      expect(vi.mocked(processTemplate)).toHaveBeenCalledTimes(2);
      const templateDirs = vi.mocked(processTemplate).mock.calls.map(([td]) => td);
      expect(templateDirs.some((d) => d.includes(join('route', 'src', 'routes')))).toBe(true);
      expect(templateDirs.some((d) => d.includes(join('route', 'test')))).toBe(true);
    });

    it('skips the test file when --no-test is passed', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateRoute.run(['ProductRoute', '--output-dir', '/tmp/routes', '--no-test'], ROOT);

      expect(vi.mocked(processTemplate)).toHaveBeenCalledOnce();
      const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(templateDir).toContain(join('route', 'src', 'routes'));
    });
  });

  describe('output and template options', () => {
    it('uses ./src/routes as the default output directory for the route file', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateRoute.run(['ProductRoute', '--no-test'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(join(ROOT, 'src', 'routes'));
    });

    it('passes force: true to both processTemplate calls when --force is set', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateRoute.run(['ProductRoute', '--output-dir', '/tmp/routes', '--force'], ROOT);

      for (const call of vi.mocked(processTemplate).mock.calls) {
        expect(call[3]).toMatchObject({ force: true });
      }
    });
  });
});
