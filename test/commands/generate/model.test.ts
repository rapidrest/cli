import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
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
  readProjectDatastores: vi.fn(),
  readProjectName: vi.fn(),
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('../../../src/commands/generate/docker.js', () => ({
  default: { run: vi.fn() },
}));

vi.mock('../../../src/commands/generate/k8s.js', () => ({
  default: { run: vi.fn() },
}));

import { input, select, confirm } from '@inquirer/prompts';
import { existsSync } from 'fs';
import { processTemplate } from '../../../src/lib/template.js';
import { readProjectDatastores, readProjectName } from '../../../src/lib/project.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import GenerateDocker from '../../../src/commands/generate/docker.js';
import GenerateHelm from '../../../src/commands/generate/k8s.js';
import GenerateModel from '../../../src/commands/generate/model.js';

const ROOT = process.cwd();

const DEFAULT_DATASTORES = [
  { name: 'acl', type: 'mongodb' },
  { name: 'mongo', type: 'mongodb' },
];

// Default prompt order when configured datastores are present and --cache is omitted
// (the normal case): input(description) → select(datastore name) → confirm(enable cache?)
// → input(cache TTL) → confirm(protect) → inputAuthor(cwd).
//
// --cache has three distinct behaviors (see model.ts's resolveCacheArgv):
//   - omitted entirely      → prompts interactively via confirm()+input() (defaults to '60')
//   - passed with no value  → resolves to '60' with no prompt
//   - passed with a value   → uses that value with no prompt
function stubPrompts({
  description = 'A test model',
  datastore = 'mongo',
  cacheEnabled = true,
  cache = '60',
  protect = false,
  author,
}: {
  description?: string;
  datastore?: string;
  cacheEnabled?: boolean;
  cache?: string;
  protect?: boolean;
  author?: string;
} = {}) {
  vi.mocked(input).mockResolvedValueOnce(description);
  vi.mocked(select).mockResolvedValueOnce(datastore);
  vi.mocked(confirm).mockResolvedValueOnce(cacheEnabled);
  if (cacheEnabled) {
    vi.mocked(input).mockResolvedValueOnce(cache);
  }
  vi.mocked(confirm).mockResolvedValueOnce(protect);
  if (author !== undefined) vi.mocked(inputAuthor).mockResolvedValueOnce(author);
}

describe('generate model', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(inputAuthor).mockResolvedValue('Default Author');
    vi.mocked(readProjectDatastores).mockResolvedValue(DEFAULT_DATASTORES);
    vi.mocked(readProjectName).mockResolvedValue('my-app');
    vi.mocked(existsSync).mockReturnValue(false);
    (GenerateDocker as any).run.mockResolvedValue(undefined);
    (GenerateHelm as any).run.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('context building', () => {
    it('builds the correct context from prompts and passes it to processTemplate', async () => {
      stubPrompts({ description: 'A product entity', datastore: 'mongo', cache: '120', protect: true, author: 'Jane Doe' });
      await GenerateModel.run(['Product', '--output-dir', '/tmp/test-models'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        name: 'Product',
        description: 'A product entity',
        datastore: 'mongo',
        datastoreType: 'mongodb',
        cache: '120',
        protect: true,
        author: 'Jane Doe',
        year: new Date().getFullYear(),
      });
    });

    it('prompts for a cache TTL when --cache is omitted entirely and the user enables caching', async () => {
      stubPrompts({ cache: '90', author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe('90');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + cache prompt
      expect(vi.mocked(confirm)).toHaveBeenCalledWith(expect.objectContaining({ message: 'Enable caching for this model?' }));
    });

    it('includes protect: false when the protect prompt answers no', async () => {
      stubPrompts({ protect: false, author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.protect).toBe(false);
    });

    it('disables caching when the user declines the enable-caching prompt', async () => {
      stubPrompts({ cacheEnabled: false, author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe('');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // description only, no cache TTL prompt
    });

    it('sets isMongoDb true and other db booleans false when datastoreType is mongodb', async () => {
      stubPrompts({ datastore: 'mongo', author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.isMongoDb).toBe(true);
      expect(context.isPostgreSql).toBe(false);
      expect(context.isSqlite).toBe(false);
      expect(context.isRedis).toBe(false);
    });

    it('includes project_name from package.json in the context', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.project_name).toBe('my-app');
    });
  });

  describe('datastore selection — configured datastores present', () => {
    it('shows only non-acl datastores in the select choices, plus a new option', async () => {
      stubPrompts({ datastore: 'mongo', author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const firstSelectCall = vi.mocked(select).mock.calls[0][0] as any;
      const choices = firstSelectCall.choices;
      expect(choices[0]).toEqual({ name: 'mongo (mongodb)', value: 'mongo' });
      expect(choices[choices.length - 1]).toEqual({ name: '+ New datastore...', value: '__new__' });
      expect(choices.some((c: any) => c.value === 'acl')).toBe(false);
    });

    it('resolves datastoreType from the config list for the selected name', async () => {
      stubPrompts({ datastore: 'mongo', author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('mongo');
      expect(context.datastoreType).toBe('mongodb');
    });

    it('resolves an empty datastoreType when the selected name is not in the configured list', async () => {
      stubPrompts({ datastore: 'orphan', author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('orphan');
      expect(context.datastoreType).toBe('');
    });

    it('selecting "+ New datastore..." prompts for db type and uses it as both name and type', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(select)
        .mockResolvedValueOnce('__new__')  // datastore select → new
        .mockResolvedValueOnce('sqlite');   // db type
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('sqlite');
      expect(context.datastoreType).toBe('sqlite');
      expect(vi.mocked(select)).toHaveBeenCalledTimes(2);  // datastore + db type
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(2); // enable caching? + protect
    });

    it('does not show the "set up new database" prompt when datastores are configured', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      // 1 select (datastore name) + 2 confirms (enable caching? + protect) — no "set up new?" confirm
      expect(vi.mocked(select)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(2);
    });
  });

  describe('datastore selection — no configured datastores', () => {
    beforeEach(() => {
      vi.mocked(readProjectDatastores).mockResolvedValue([]);
    });

    it('asks to set up a new database and selects the type when the user says yes', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // "set up new?" → yes
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false); // protect
      vi.mocked(select).mockResolvedValueOnce('postgres'); // db type

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('postgres');
      expect(context.datastoreType).toBe('postgres');
      expect(vi.mocked(select)).toHaveBeenCalledTimes(1);   // db type only
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(3);  // setup? + enable caching? + protect
    });

    it('sets datastore and datastoreType to empty string when the user declines', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // "set up new?" → no
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('');
      expect(context.datastoreType).toBe('');
      expect(vi.mocked(select)).not.toHaveBeenCalled();
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(3); // setup? + enable caching? + protect
    });
  });

  describe('flag shortcuts bypass prompts', () => {
    it('--datastore skips the datastore select but still resolves datastoreType from config', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--datastore', 'mongo'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('mongo');
      expect(context.datastoreType).toBe('mongodb');
      expect(readProjectDatastores).toHaveBeenCalledOnce();
      expect(vi.mocked(select)).not.toHaveBeenCalled();
    });

    it('--datastore leaves datastoreType empty when the name is not in the project config', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--datastore', 'unknown'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastoreType).toBe('');
    });

    it('--description skips the description input prompt', async () => {
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      // --cache (bare) also provided so the cache prompt doesn't fire, isolating this test to description only
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--description', 'From flag', '--cache'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.description).toBe('From flag');
      expect(context.cache).toBe('60');
      expect(vi.mocked(input)).not.toHaveBeenCalled();
    });

    it('--cache with a value overrides the default TTL and skips the cache prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect only

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '300'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe('300');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // description only, no cache prompt
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1); // protect only, no enable-caching prompt
    });

    it('--cache with no value defaults to "60" and skips the cache prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect only

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe('60');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // description only, no cache prompt
    });

    it('--cache with no value still resolves to "60" when immediately followed by another flag', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '--protect'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe('60');
      expect(context.protect).toBe(true);
      expect(vi.mocked(confirm)).not.toHaveBeenCalled();
    });

    it('explicitly setting --cache to an empty string still triggers the enable-caching prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // enable caching? → no
        .mockResolvedValueOnce(false); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', ''], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe('');
    });

    it('--protect skips the protect confirm prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(true); // enable caching?

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--protect'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.protect).toBe(true);
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1); // enable caching? only, no protect confirm
    });

    it('--author skips inputAuthor entirely', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      // --cache (bare) also provided so the cache prompt doesn't fire, isolating this test to author only
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--author', 'Flag Author', '--cache'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // only description; cache resolved from bare --cache flag
    });
  });

  describe('author resolution', () => {
    it('calls inputAuthor with the project cwd and uses its return value', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author <git@example.com>');
      stubPrompts();

      await GenerateModel.run(['Product', '--output-dir', '/tmp/test-models'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author <git@example.com>');
      expect(inputAuthor).toHaveBeenCalledWith(process.cwd());
    });
  });

  describe('output and template options', () => {
    it('uses process.cwd() as the default output directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(ROOT);
    });

    it('passes force: true to processTemplate when --force is set', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--force'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: true });
    });

    it('points processTemplate at the model template directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(templateDir).toContain(join('templates', 'model'));
    });
  });

  describe('docker and helm subcommands after new datastore', () => {
    it('does not call GenerateDocker or GenerateHelm when an existing datastore is selected', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      expect((GenerateDocker as any).run).not.toHaveBeenCalled();
      expect((GenerateHelm as any).run).not.toHaveBeenCalled();
    });

    it('offers to update docker when a new datastore is added and docker-compose.yml exists', async () => {
      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('docker-compose.yml'),
      );
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(select)
        .mockResolvedValueOnce('__new__')
        .mockResolvedValueOnce('mongodb');
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false)  // protect
        .mockResolvedValueOnce(true);  // update docker?

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/m', '--force'],
        expect.any(String),
      );
    });

    it('skips docker update when the user declines', async () => {
      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('docker-compose.yml'),
      );
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(select)
        .mockResolvedValueOnce('__new__')
        .mockResolvedValueOnce('mongodb');
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false)  // protect
        .mockResolvedValueOnce(false); // update docker? → no

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      expect((GenerateDocker as any).run).not.toHaveBeenCalled();
    });

    it('offers to update helm when a new datastore is added and helm/Chart.yaml exists', async () => {
      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('Chart.yaml'),
      );
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(select)
        .mockResolvedValueOnce('__new__')
        .mockResolvedValueOnce('mongodb');
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false)  // protect
        .mockResolvedValueOnce(true);  // update helm?

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      expect((GenerateHelm as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/m', '--force'],
        expect.any(String),
      );
    });

    it('skips helm update when the user declines', async () => {
      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('Chart.yaml'),
      );
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(select)
        .mockResolvedValueOnce('__new__')
        .mockResolvedValueOnce('mongodb');
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false)  // protect
        .mockResolvedValueOnce(false); // update helm? → no

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      expect((GenerateHelm as any).run).not.toHaveBeenCalled();
    });

    it('offers to update both docker and helm when both exist for a new datastore', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60'); // description, cache
      vi.mocked(select)
        .mockResolvedValueOnce('__new__')
        .mockResolvedValueOnce('mongodb');
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // enable caching?
        .mockResolvedValueOnce(false)  // protect
        .mockResolvedValueOnce(true)   // update docker?
        .mockResolvedValueOnce(true);  // update helm?

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledOnce();
      expect((GenerateHelm as any).run).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('propagates an error thrown by processTemplate', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue(new Error('template boom'));

      await expect(
        GenerateModel.run(['Product', '--output-dir', '/tmp/test-models'], ROOT),
      ).rejects.toThrow('template boom');
    });

    it('falls back to String(err) when processTemplate rejects with a non-Error value', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue('non-error-boom');

      await expect(
        GenerateModel.run(['Product', '--output-dir', '/tmp/test-models'], ROOT),
      ).rejects.toThrow('non-error-boom');
    });
  });
});
