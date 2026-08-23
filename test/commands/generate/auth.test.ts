///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
}));

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  detectApiRoute: vi.fn(),
  readProjectDatastores: vi.fn(),
  readProjectName: vi.fn(),
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

import { select } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { detectApiRoute, readProjectDatastores, readProjectName } from '../../../src/lib/project.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import GenerateAuth from '../../../src/commands/generate/auth.js';

const ROOT = process.cwd();

describe('generate auth', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(inputAuthor).mockResolvedValue('Default Author');
    vi.mocked(readProjectDatastores).mockResolvedValue([]);
    vi.mocked(readProjectName).mockResolvedValue('my-app');
    vi.mocked(detectApiRoute).mockResolvedValue({ apiRoute: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('datastore type resolution', () => {
    it('--datastore-type sql skips the datastore-type select', async () => {
      vi.mocked(select).mockResolvedValueOnce('better-sqlite3'); // sql-type (no existing "sql" datastore)

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).toHaveBeenCalledTimes(1); // sql-type only
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ datastore: 'sql', isSql: true, isSqlite: true, isPostgreSql: false });
    });

    it('rejects an invalid --datastore-type', async () => {
      await expect(
        GenerateAuth.run(['--datastore-type', 'redis', '--output-dir', '/tmp/auth'], ROOT),
      ).rejects.toThrow(/Invalid --datastore-type "redis"/);
    });

    it('prompts for datastore type when --datastore-type is omitted', async () => {
      vi.mocked(select).mockResolvedValueOnce('mongo');

      await GenerateAuth.run(['--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('mongo');
      expect(context.isSql).toBe(false);
    });

    it('--datastore-type mongo never prompts for a sql sub-type', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ isSql: false, isPostgreSql: false, isSqlite: false });
    });
  });

  describe('sql sub-type resolution', () => {
    it('--sql-type skips the sql-type select', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'sql', '--sql-type', 'postgres', '--output-dir', '/tmp/auth', '--author', 'A'],
        ROOT,
      );

      expect(vi.mocked(select)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ isPostgreSql: true, isSqlite: false });
    });

    it('rejects an invalid --sql-type', async () => {
      await expect(
        GenerateAuth.run(['--datastore-type', 'sql', '--sql-type', 'oracle', '--output-dir', '/tmp/auth'], ROOT),
      ).rejects.toThrow(/Invalid --sql-type "oracle"/);
    });

    it('derives isPostgreSql/isSqlite from an already-configured "sql" datastore instead of prompting', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'sql', type: 'postgres' }]);

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ isPostgreSql: true, isSqlite: false });
    });

    it('derives isSqlite when the existing "sql" datastore is better-sqlite3', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'sql', type: 'better-sqlite3' }]);

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ isPostgreSql: false, isSqlite: true });
    });

    it('a datastore literally named "mongo" does not satisfy --datastore-type sql', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'mongo', type: 'mongodb' }]);
      vi.mocked(select).mockResolvedValueOnce('better-sqlite3');

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).toHaveBeenCalledOnce(); // still prompts for sql-type
    });

    it('prompts for the sql sub-type when creating a new "sql" datastore and --sql-type is omitted', async () => {
      vi.mocked(select).mockResolvedValueOnce('postgres');

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('No "sql" datastore is configured'),
      }));
    });
  });

  describe('context building', () => {
    it('includes author, project_name, and year', async () => {
      vi.mocked(readProjectName).mockResolvedValue('cool-api');

      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'Jane'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ author: 'Jane', project_name: 'cool-api', year: new Date().getFullYear() });
    });

    it('--author skips inputAuthor', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
    });

    it('falls back to inputAuthor when --author is omitted', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author');

      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author');
      expect(inputAuthor).toHaveBeenCalledWith(process.cwd());
    });

    it('includes apiRoute/apiVersion detected from the project', async () => {
      vi.mocked(detectApiRoute).mockResolvedValue({ apiRoute: true, apiVersion: '2' });

      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ apiRoute: true, apiVersion: '2' });
    });

    it('sets defaultAccounts: false by default', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.defaultAccounts).toBe(false);
    });

    it('--default-accounts sets defaultAccounts: true', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--default-accounts'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.defaultAccounts).toBe(true);
    });
  });

  describe('output and template options', () => {
    it('defaults the output directory to process.cwd()', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--author', 'A'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(process.cwd());
    });

    it('uses --output-dir when provided', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/custom/path', '--author', 'A'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe('/custom/path');
    });

    it('points processTemplate at the auth template directory', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(templateDir).toContain(join('templates', 'auth'));
    });

    it('passes force: true and the project cwd as projectDir when --force is set', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--force'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: true, projectDir: process.cwd() });
    });

    it('passes force: undefined when --force is not set', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: undefined });
    });
  });

  describe('error handling', () => {
    it('propagates an error thrown by processTemplate', async () => {
      vi.mocked(processTemplate).mockRejectedValue(new Error('template boom'));

      await expect(
        GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT),
      ).rejects.toThrow('template boom');
    });

    it('falls back to String(err) when processTemplate rejects with a non-Error value', async () => {
      vi.mocked(processTemplate).mockRejectedValue('non-error-boom');

      await expect(
        GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT),
      ).rejects.toThrow('non-error-boom');
    });
  });
});
