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

// Default stub order when configured datastores are present (the normal case):
//   input(description) → select(datastore name) → confirm(cache) → confirm(protect) → inputAuthor(cwd)
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
  vi.mocked(select).mockResolvedValueOnce(datastore as any);
  vi.mocked(confirm).mockResolvedValueOnce(cache).mockResolvedValueOnce(protect);
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
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select)
        .mockResolvedValueOnce('__new__' as any)  // datastore select → new
        .mockResolvedValueOnce('sqlite' as any);   // db type
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)              // cache
        .mockResolvedValueOnce(false);             // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('sqlite');
      expect(context.datastoreType).toBe('sqlite');
      expect(vi.mocked(select)).toHaveBeenCalledTimes(2);  // datastore + db type
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(2); // cache + protect
    });

    it('does not show the "set up new database" prompt when datastores are configured', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      // 1 select (datastore name) + 2 confirms (cache + protect) — no "set up new?" confirm
      expect(vi.mocked(select)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(2);
    });
  });

  describe('datastore selection — no configured datastores', () => {
    beforeEach(() => {
      vi.mocked(readProjectDatastores).mockResolvedValue([]);
    });

    it('asks to set up a new database and selects the type when the user says yes', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)   // "set up new?" → yes
        .mockResolvedValueOnce(false)  // cache
        .mockResolvedValueOnce(false); // protect
      vi.mocked(select).mockResolvedValueOnce('postgres' as any); // db type

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('postgres');
      expect(context.datastoreType).toBe('postgres');
      expect(vi.mocked(select)).toHaveBeenCalledTimes(1);   // db type only
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(3);  // setup? + cache + protect
    });

    it('sets datastore and datastoreType to empty string when the user declines', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // "set up new?" → no
        .mockResolvedValueOnce(false)  // cache
        .mockResolvedValueOnce(false); // protect

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('');
      expect(context.datastoreType).toBe('');
      expect(vi.mocked(select)).not.toHaveBeenCalled();
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(3); // setup? + cache + protect
    });
  });

  describe('flag shortcuts bypass prompts', () => {
    it('--datastore skips the datastore select but still resolves datastoreType from config', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(false);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--datastore', 'mongo'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('mongo');
      expect(context.datastoreType).toBe('mongodb');
      expect(readProjectDatastores).toHaveBeenCalledOnce();
      expect(vi.mocked(select)).not.toHaveBeenCalled();
    });

    it('--datastore leaves datastoreType empty when the name is not in the project config', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(false);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--datastore', 'unknown'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastoreType).toBe('');
    });

    it('--description skips the description input prompt', async () => {
      vi.mocked(select).mockResolvedValueOnce('mongo' as any);
      vi.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(false);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--description', 'From flag'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.description).toBe('From flag');
      expect(vi.mocked(input)).not.toHaveBeenCalled();
    });

    it('--cache skips the cache confirm prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo' as any);
      vi.mocked(confirm).mockResolvedValueOnce(false); // protect only

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--cache'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.cache).toBe(true);
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1); // protect only
    });

    it('--protect skips the protect confirm prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo' as any);
      vi.mocked(confirm).mockResolvedValueOnce(false); // cache only

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--protect'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.protect).toBe(true);
      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1); // cache only
    });

    it('--author skips inputAuthor entirely', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select).mockResolvedValueOnce('mongo' as any);
      vi.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(false);

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // only description
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
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select)
        .mockResolvedValueOnce('__new__' as any)
        .mockResolvedValueOnce('mongodb' as any);
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // cache
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
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select)
        .mockResolvedValueOnce('__new__' as any)
        .mockResolvedValueOnce('mongodb' as any);
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // cache
        .mockResolvedValueOnce(false)  // protect
        .mockResolvedValueOnce(false); // update docker? → no

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      expect((GenerateDocker as any).run).not.toHaveBeenCalled();
    });

    it('offers to update helm when a new datastore is added and helm/Chart.yaml exists', async () => {
      vi.mocked(existsSync).mockImplementation((p) =>
        String(p).endsWith('Chart.yaml'),
      );
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select)
        .mockResolvedValueOnce('__new__' as any)
        .mockResolvedValueOnce('mongodb' as any);
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // cache
        .mockResolvedValueOnce(false)  // protect
        .mockResolvedValueOnce(true);  // update helm?

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      expect((GenerateHelm as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/m', '--force'],
        expect.any(String),
      );
    });

    it('offers to update both docker and helm when both exist for a new datastore', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(input).mockResolvedValueOnce('A desc');
      vi.mocked(select)
        .mockResolvedValueOnce('__new__' as any)
        .mockResolvedValueOnce('mongodb' as any);
      vi.mocked(confirm)
        .mockResolvedValueOnce(false)  // cache
        .mockResolvedValueOnce(false)  // protect
        .mockResolvedValueOnce(true)   // update docker?
        .mockResolvedValueOnce(true);  // update helm?

      await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledOnce();
      expect((GenerateHelm as any).run).toHaveBeenCalledOnce();
    });
  });
});
