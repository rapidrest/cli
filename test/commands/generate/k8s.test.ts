import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  readProjectDatastores: vi.fn(),
  readProjectName: vi.fn(),
}));

import { processTemplate } from '../../../src/lib/template.js';
import { readProjectDatastores, readProjectName } from '../../../src/lib/project.js';
import GenerateHelm from '../../../src/commands/generate/k8s.js';

const ROOT = process.cwd();

describe('generate k8s', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(readProjectDatastores).mockResolvedValue([]);
    vi.mocked(readProjectName).mockResolvedValue('my-app');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('context building', () => {
    it('passes datastores from the project config into context', async () => {
      const datastores = [{ name: 'acl', type: 'mongodb' }, { name: 'cache', type: 'redis' }];
      vi.mocked(readProjectDatastores).mockResolvedValue(datastores);

      await GenerateHelm.run([], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastores).toEqual(datastores);
    });

    it('includes the current year in context', async () => {
      await GenerateHelm.run([], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.year).toBe(new Date().getFullYear());
    });

    it('includes project_name from package.json in context', async () => {
      vi.mocked(readProjectName).mockResolvedValue('my-service');

      await GenerateHelm.run([], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.project_name).toBe('my-service');
    });
  });

  describe('database boolean flags', () => {
    it('sets hasMongoDB true when any datastore type is mongodb', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'db', type: 'mongodb' }]);

      await GenerateHelm.run([], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hasMongoDB).toBe(true);
      expect(context.hasPostgres).toBe(false);
      expect(context.hasRedis).toBe(false);
    });

    it('sets hasPostgres true when any datastore type is postgresql', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'db', type: 'postgresql' }]);

      await GenerateHelm.run([], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hasPostgres).toBe(true);
      expect(context.hasMongoDB).toBe(false);
      expect(context.hasRedis).toBe(false);
    });

    it('sets hasRedis true when any datastore type is redis', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'cache', type: 'redis' }]);

      await GenerateHelm.run([], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hasRedis).toBe(true);
      expect(context.hasMongoDB).toBe(false);
      expect(context.hasPostgres).toBe(false);
    });

    it('sets all boolean flags true when all three types are present', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([
        { name: 'acl', type: 'mongodb' },
        { name: 'pg', type: 'postgresql' },
        { name: 'cache', type: 'redis' },
      ]);

      await GenerateHelm.run([], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hasMongoDB).toBe(true);
      expect(context.hasPostgres).toBe(true);
      expect(context.hasRedis).toBe(true);
    });

    it('sets all boolean flags false when datastores is empty', async () => {
      await GenerateHelm.run([], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hasMongoDB).toBe(false);
      expect(context.hasPostgres).toBe(false);
      expect(context.hasRedis).toBe(false);
    });

    it('ignores unknown datastore types for boolean flags', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'store', type: 'sqlite' }]);

      await GenerateHelm.run([], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hasMongoDB).toBe(false);
      expect(context.hasPostgres).toBe(false);
      expect(context.hasRedis).toBe(false);
    });
  });

  describe('output and template options', () => {
    it('uses process.cwd() as the output directory when --output-dir is not set', async () => {
      await GenerateHelm.run([], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(process.cwd());
    });

    it('uses --output-dir as the output directory and project source when provided', async () => {
      await GenerateHelm.run(['--output-dir', '/custom/project'], ROOT);

      const [, outputDir, , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe('/custom/project');
      expect(opts).toMatchObject({ projectDir: '/custom/project' });
      expect(readProjectDatastores).toHaveBeenCalledWith('/custom/project');
      expect(readProjectName).toHaveBeenCalledWith('/custom/project');
    });

    it('points processTemplate at the helm template directory', async () => {
      await GenerateHelm.run([], ROOT);

      const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(templateDir).toContain(join('templates', 'helm'));
    });

    it('passes force: true to processTemplate when --force is set', async () => {
      await GenerateHelm.run(['--force'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: true });
    });

    it('passes projectDir: process.cwd() to processTemplate', async () => {
      await GenerateHelm.run([], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ projectDir: process.cwd() });
    });

    it('calls readProjectDatastores with the current working directory', async () => {
      await GenerateHelm.run([], ROOT);

      expect(readProjectDatastores).toHaveBeenCalledWith(process.cwd());
    });

    it('calls readProjectName with the current working directory', async () => {
      await GenerateHelm.run([], ROOT);

      expect(readProjectName).toHaveBeenCalledWith(process.cwd());
    });
  });
});
