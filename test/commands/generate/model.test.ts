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
  readProjectDatastores: vi.fn(),
  readProjectName: vi.fn(),
}));

import { input, select } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { readProjectAuthor, readProjectDatastores, readProjectName } from '../../../src/lib/project.js';
import GenerateModel from '../../../src/commands/generate/model.js';

const ROOT = process.cwd();

const DEFAULT_DATASTORES = [
  { name: 'acl', type: 'mongodb' },
  { name: 'mongo', type: 'mongodb' },
];

// Default stub order when configured datastores are present (the normal case):
//   input(description) → select(datastore name) → select(cache) → select(protect) → input(author)?
// The datastore select returns the name string; datastoreType is looked up from the configured list.
function stubPrompts({
  description = 'A test model',
  datastore = 'mongo',
  cache = false,
  protect = false,
  author,
}: {
  description?: string;
  datastore?: string;
  cache?: boolean;
  protect?: boolean;
  author?: string;
} = {}) {
  vi.mocked(input).mockResolvedValueOnce(description);
  vi.mocked(select)
    .mockResolvedValueOnce(datastore as any)
    .mockResolvedValueOnce(cache as any)
    .mockResolvedValueOnce(protect as any);
  if (author !== undefined) vi.mocked(input).mockResolvedValueOnce(author);
}

describe('generate model', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(readProjectAuthor).mockResolvedValue(undefined);
    vi.mocked(readProjectDatastores).mockResolvedValue(DEFAULT_DATASTORES);
    vi.mocked(readProjectName).mockResolvedValue('my-app');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('context building', () => {
    it('builds the correct context from prompts and passes it to processTemplate', async () => {
      stubPrompts({ description: 'A product entity', datastore: 'mongo', cache: true, protect: true, author: 'Jane Doe' });
      await GenerateModel.run(['Product', '--output-dir', '/tmp/test-models'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        name: 'Product',
        description: 'A product entity',
        datastore: 'mongo',
        datastoreType: 'mongodb',
        cache: true,
        protect: true,
        author: 'Jane Doe',
        year: new Date().getFullYear(),
      });
    });

    it('includes cache: false and protect: false when those prompts answer no', async () => {
      stubPrompts({ cache: false, protect: false, author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe(false);
      expect(context.protect).toBe(false);
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

    it('selecting "+ New datastore..." prompts for db type and uses it as both name and type', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('Author');
      vi.mocked(select)
        .mockResolvedValueOnce('__new__' as any)  // datastore select → new
        .mockResolvedValueOnce('sqlite' as any)   // db type
        .mockResolvedValueOnce(false as any)       // cache
        .mockResolvedValueOnce(false as any);      // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('sqlite');
      expect(context.datastoreType).toBe('sqlite');
      expect(vi.mocked(select)).toHaveBeenCalledTimes(4); // datastore + type + cache + protect
    });

    it('does not show the "set up new database" prompt when datastores are configured', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      // 3 selects: datastore + cache + protect (no "set up new?" select)
      expect(vi.mocked(select)).toHaveBeenCalledTimes(3);
    });
  });

  describe('datastore selection — no configured datastores', () => {
    beforeEach(() => {
      vi.mocked(readProjectDatastores).mockResolvedValue([]);
    });

    it('asks to set up a new database and selects the type when the user says yes', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('Author');
      vi.mocked(select)
        .mockResolvedValueOnce(true as any)       // "set up new?" → yes
        .mockResolvedValueOnce('postgres' as any) // db type
        .mockResolvedValueOnce(false as any)      // cache
        .mockResolvedValueOnce(false as any);     // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('postgres');
      expect(context.datastoreType).toBe('postgres');
      expect(vi.mocked(select)).toHaveBeenCalledTimes(4); // setup? + type + cache + protect
    });

    it('sets datastore and datastoreType to empty string when the user declines', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('Author');
      vi.mocked(select)
        .mockResolvedValueOnce(false as any)  // "set up new?" → no
        .mockResolvedValueOnce(false as any)  // cache
        .mockResolvedValueOnce(false as any); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('');
      expect(context.datastoreType).toBe('');
      expect(vi.mocked(select)).toHaveBeenCalledTimes(3); // setup? + cache + protect
    });
  });

  describe('flag shortcuts bypass prompts', () => {
    it('--datastore skips the datastore select but still resolves datastoreType from config', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce(false as any).mockResolvedValueOnce(false as any);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--datastore', 'mongo'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('mongo');
      expect(context.datastoreType).toBe('mongodb');
      expect(readProjectDatastores).toHaveBeenCalledOnce();
      expect(vi.mocked(select)).toHaveBeenCalledTimes(2); // cache + protect only
    });

    it('--datastore leaves datastoreType empty when the name is not in the project config', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce(false as any).mockResolvedValueOnce(false as any);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--datastore', 'unknown'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastoreType).toBe('');
    });

    it('--description skips the description input prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('Author');
      vi.mocked(select)
        .mockResolvedValueOnce('mongo' as any)
        .mockResolvedValueOnce(false as any)
        .mockResolvedValueOnce(false as any);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--description', 'From flag'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.description).toBe('From flag');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // only author
    });

    it('--cache skips the cache select prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('Author');
      vi.mocked(select)
        .mockResolvedValueOnce('mongo' as any)  // datastore
        .mockResolvedValueOnce(false as any);   // protect only

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe(true);
      expect(vi.mocked(select)).toHaveBeenCalledTimes(2); // datastore + protect
    });

    it('--protect skips the protect select prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('Author');
      vi.mocked(select)
        .mockResolvedValueOnce('mongo' as any)  // datastore
        .mockResolvedValueOnce(false as any);   // cache only

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--protect'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.protect).toBe(true);
      expect(vi.mocked(select)).toHaveBeenCalledTimes(2); // datastore + cache
    });

    it('--author skips all author resolution (package.json and input prompt)', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select)
        .mockResolvedValueOnce('mongo' as any)
        .mockResolvedValueOnce(false as any)
        .mockResolvedValueOnce(false as any);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(readProjectAuthor).not.toHaveBeenCalled();
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // only description
    });

    it('--author takes precedence over package.json author', async () => {
      vi.mocked(readProjectAuthor).mockResolvedValue('Package Author');
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select)
        .mockResolvedValueOnce('mongo' as any)
        .mockResolvedValueOnce(false as any)
        .mockResolvedValueOnce(false as any);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
    });
  });

  describe('author resolution priority', () => {
    it('uses package.json author without prompting when no --author flag', async () => {
      vi.mocked(readProjectAuthor).mockResolvedValue('Package Author');
      stubPrompts(); // no author arg — author input prompt should not fire

      await GenerateModel.run(['Product', '--output-dir', '/tmp/test-models'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Package Author');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // description only
    });

    it('falls back to the author input prompt when package.json has no author', async () => {
      stubPrompts({ author: 'Prompted Author' });

      await GenerateModel.run(['Product', '--output-dir', '/tmp/test-models'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Prompted Author');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + author
    });
  });

  describe('output and template options', () => {
    it('uses ./src/models as the default output directory', async () => {
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
});
