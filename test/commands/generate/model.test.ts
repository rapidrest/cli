///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
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

vi.mock('../../../src/lib/project.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/project.js')>();
  return {
    ...actual,
    readGitAuthor: vi.fn(),
    readProjectAuthor: vi.fn(),
    readProjectDatastores: vi.fn(),
    readProjectName: vi.fn(),
  };
});

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
// → input(cache TTL) → confirm(protect) → input(property name, blank to finish) → inputAuthor(cwd).
//
// --cache has three distinct behaviors (see model.ts's resolveCacheArgv):
//   - omitted entirely      → prompts interactively via confirm()+input() (defaults to '60')
//   - passed with no value  → resolves to '60' with no prompt
//   - passed with a value   → uses that value with no prompt
//
// The property-adding loop is skipped (a single blank-name input) unless `properties` is passed.
function stubPrompts({
  description = 'A test model',
  datastore = 'mongo',
  cacheEnabled = true,
  cache = '60',
  protect = false,
  properties = [],
  author,
}: {
  description?: string;
  datastore?: string;
  cacheEnabled?: boolean;
  cache?: string;
  protect?: boolean;
  properties?: Array<{ name: string; type: string; other?: string; optional?: boolean; description?: string }>;
  author?: string;
} = {}) {
  vi.mocked(input).mockResolvedValueOnce(description);
  vi.mocked(select).mockResolvedValueOnce(datastore);
  vi.mocked(confirm).mockResolvedValueOnce(cacheEnabled);
  if (cacheEnabled) {
    vi.mocked(input).mockResolvedValueOnce(cache);
  }
  vi.mocked(confirm).mockResolvedValueOnce(protect);
  for (const p of properties) {
    vi.mocked(input).mockResolvedValueOnce(p.name);
    vi.mocked(select).mockResolvedValueOnce(p.type === 'other' ? '__other__' : p.type);
    if (p.type === 'other') vi.mocked(input).mockResolvedValueOnce(p.other ?? 'CustomType');
    vi.mocked(confirm).mockResolvedValueOnce(p.optional ?? false);
    vi.mocked(input).mockResolvedValueOnce(p.description ?? '');
  }
  vi.mocked(input).mockResolvedValueOnce(''); // property name prompt → blank, ends the loop
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
      expect(vi.mocked(input)).toHaveBeenCalledTimes(3); // description + cache prompt + property name (blank)
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
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + property name (blank), no cache TTL prompt
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

    it('sets isPostgreSql true when an existing datastore\'s type is "postgres" (TypeORM\'s own driver literal)', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([
        ...DEFAULT_DATASTORES,
        { name: 'pg', type: 'postgres' },
      ]);
      stubPrompts({ datastore: 'pg', author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.isPostgreSql).toBe(true);
      expect(context.isMongoDb).toBe(false);
      expect(context.isSqlite).toBe(false);
    });

    it('sets isSqlite true when an existing datastore\'s type is "better-sqlite3" (TypeORM\'s own driver literal)', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([
        ...DEFAULT_DATASTORES,
        { name: 'sqlite', type: 'better-sqlite3' },
      ]);
      stubPrompts({ datastore: 'sqlite', author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.isSqlite).toBe(true);
      expect(context.isMongoDb).toBe(false);
      expect(context.isPostgreSql).toBe(false);
    });

    it('sets isSqlite true for a brand new datastore (the "Select database type" prompt uses the friendly "sqlite" value)', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60');
      vi.mocked(select)
        .mockResolvedValueOnce('__new__')
        .mockResolvedValueOnce('sqlite');
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.isSqlite).toBe(true);
    });

    it('sets isPostgreSql true for a brand new datastore (the "Select database type" prompt already uses TypeORM\'s "postgres" value)', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('60');
      vi.mocked(select)
        .mockResolvedValueOnce('__new__')
        .mockResolvedValueOnce('postgres');
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.isPostgreSql).toBe(true);
      expect(context.datastore).toBe('postgres');
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
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // property name (blank) only
    });

    it('--cache with a value overrides the default TTL and skips the cache prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect only

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '300'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe('300');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + property name (blank), no cache prompt
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1); // protect only, no enable-caching prompt
    });

    it('--cache with no value defaults to "60" and skips the cache prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect only

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe('60');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + property name (blank), no cache prompt
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
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + property name (blank); cache resolved from bare --cache flag
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

  describe('property definitions — interactive prompt', () => {
    it('adds no properties by default (blank name ends the loop immediately)', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.properties).toEqual([]);
      expect(context.hasOptionalProperty).toBe(false);
    });

    it('adds a single required property from the prompt loop', async () => {
      stubPrompts({
        properties: [{ name: 'quantity', type: 'number', description: 'Stock count' }],
        author: 'Author',
      });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.properties).toEqual([
        { name: 'quantity', type: 'number', optional: false, description: 'Stock count', defaultValue: '0' },
      ]);
      expect(context.hasOptionalProperty).toBe(false);
    });

    it('adds an optional property and sets hasOptionalProperty', async () => {
      stubPrompts({
        properties: [{ name: 'bio', type: 'string', optional: true, description: 'A bio' }],
        author: 'Author',
      });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.properties).toEqual([
        { name: 'bio', type: 'string', optional: true, description: 'A bio', defaultValue: 'undefined' },
      ]);
      expect(context.hasOptionalProperty).toBe(true);
    });

    it('falls back to a generic description when the property description prompt is left blank', async () => {
      stubPrompts({
        properties: [{ name: 'quantity', type: 'number' }], // description omitted → ''
        author: 'Author',
      });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context.properties as any[])[0].description).toBe('The quantity property.');
    });

    it('prompts for a custom type when "Other…" is chosen', async () => {
      stubPrompts({
        properties: [{ name: 'meta', type: 'other', other: 'Record<string, unknown>', description: 'Metadata' }],
        author: 'Author',
      });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context.properties as any[])[0]).toMatchObject({
        name: 'meta',
        type: 'Record<string, unknown>',
        defaultValue: 'undefined as any',
      });
    });

    it('adds multiple properties across repeated loop iterations', async () => {
      stubPrompts({
        properties: [
          { name: 'quantity', type: 'number' },
          { name: 'bio', type: 'string', optional: true },
          { name: 'tags', type: 'string[]' },
        ],
        author: 'Author',
      });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context.properties as any[]).map((p) => p.name)).toEqual(['quantity', 'bio', 'tags']);
      expect(context.hasOptionalProperty).toBe(true);
    });

    it("passes the already-added property names to the next property's name validator", async () => {
      stubPrompts({
        properties: [{ name: 'quantity', type: 'number' }, { name: 'bio', type: 'string' }],
        author: 'Author',
      });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      // 2nd property-name input() call is the 4th overall (description, 1st cache-related, cache TTL, quantity, ...)
      // — simplest to just check the 2nd call's validate() rejects a duplicate of the 1st property's name.
      const secondPropertyNameCall = vi.mocked(input).mock.calls.find(
        (c) => (c[0] as any).message === 'Property name (leave blank to finish adding properties):',
      );
      const validate = (secondPropertyNameCall![0] as any).validate as (v: string) => string | true;
      expect(validate('QUANTITY')).toContain('already added');
    });
  });

  describe('property definitions — validate callback', () => {
    it('rejects an invalid identifier', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const call = vi.mocked(input).mock.calls.find((c) => (c[0] as any).message?.startsWith('Property name'));
      const validate = (call![0] as any).validate as (v: string) => string | true;
      expect(validate('123bad')).toContain('not a valid property name');
    });

    it('rejects a reserved base-entity field name (case-insensitively)', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const call = vi.mocked(input).mock.calls.find((c) => (c[0] as any).message?.startsWith('Property name'));
      const validate = (call![0] as any).validate as (v: string) => string | true;
      expect(validate('UID')).toContain('base fields');
      expect(validate('dateCreated')).toContain('base fields');
    });

    it('accepts a valid, non-reserved, non-duplicate name', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const call = vi.mocked(input).mock.calls.find((c) => (c[0] as any).message?.startsWith('Property name'));
      const validate = (call![0] as any).validate as (v: string) => string | true;
      expect(validate('quantity')).toBe(true);
    });

    it('treats a blank value as valid (it ends the loop, not a validation failure)', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const call = vi.mocked(input).mock.calls.find((c) => (c[0] as any).message?.startsWith('Property name'));
      const validate = (call![0] as any).validate as (v: string) => string | true;
      expect(validate('')).toBe(true);
    });
  });

  describe('property definitions — --property flag (non-interactive)', () => {
    it('parses a single required property', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'quantity:number'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.properties).toEqual([
        { name: 'quantity', type: 'number', optional: false, description: 'The quantity property.', defaultValue: '0' },
      ]);
    });

    it('parses an optional property (trailing ? on the type)', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'bio:string?'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.properties).toEqual([
        { name: 'bio', type: 'string', optional: true, description: 'The bio property.', defaultValue: 'undefined' },
      ]);
      expect(context.hasOptionalProperty).toBe(true);
    });

    it('parses multiple repeated --property flags', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await GenerateModel.run(
        ['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'quantity:number', '--property', 'tags:string[]'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context.properties as any[]).map((p) => p.name)).toEqual(['quantity', 'tags']);
    });

    it('a non-optional custom type defaults to `undefined as any`, not a bare `undefined` (which would fail to type-check)', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await GenerateModel.run(
        ['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'sku:CustomSkuType'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context.properties as any[])[0]).toMatchObject({
        name: 'sku',
        type: 'CustomSkuType',
        optional: false,
        defaultValue: 'undefined as any',
      });
    });

    it('an optional custom type still defaults to bare `undefined` (its declared type already includes it)', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await GenerateModel.run(
        ['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'sku:CustomSkuType?'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context.properties as any[])[0]).toMatchObject({
        name: 'sku',
        type: 'CustomSkuType',
        optional: true,
        defaultValue: 'undefined',
      });
    });

    it('skips the interactive property loop entirely when --property is passed', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'quantity:number'], ROOT);

      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // description only — no property-loop prompts
    });

    it('errors on a malformed --property value with no colon', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await expect(
        GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'quantity'], ROOT),
      ).rejects.toThrow(/expected the form name:type/);
    });

    it('errors on a --property value with an invalid identifier name', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await expect(
        GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '--property', '123bad:string'], ROOT),
      ).rejects.toThrow(/not a valid property name/);
    });

    it('errors on a --property value colliding with a reserved base-entity field', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await expect(
        GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'version:number'], ROOT),
      ).rejects.toThrow(/base fields/);
    });

    it('errors on two --property flags with the same name', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await expect(
        GenerateModel.run(
          ['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'quantity:number', '--property', 'quantity:string'],
          ROOT,
        ),
      ).rejects.toThrow(/already added/);
    });

    it('errors on a --property value with no type after the colon', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo');
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect

      await expect(
        GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache', '--property', 'quantity:'], ROOT),
      ).rejects.toThrow(/missing a type/);
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
