///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  checkbox: vi.fn(),
  Separator: class {
    separator: string;
    constructor(separator: string) {
      this.separator = separator;
    }
  },
}));

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  readGitAuthor: vi.fn(),
  installIfPackageJsonChanged: vi.fn(),
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

vi.mock('../../../src/commands/generate/docker.js', () => ({
  default: { run: vi.fn() },
}));

vi.mock('../../../src/commands/generate/k8s.js', () => ({
  default: { run: vi.fn() },
}));

vi.mock('../../../src/commands/generate/react.js', () => ({
  default: { run: vi.fn() },
}));

vi.mock('../../../src/commands/generate/default-route.js', () => ({
  default: { run: vi.fn() },
}));

import { input, select, checkbox, confirm } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import GenerateDocker from '../../../src/commands/generate/docker.js';
import GenerateHelm from '../../../src/commands/generate/k8s.js';
import GenerateReact from '../../../src/commands/generate/react.js';
import GenerateDefaultRoute from '../../../src/commands/generate/default-route.js';
import GenerateServer from '../../../src/commands/generate/server.js';

const ROOT = process.cwd();

// Prompt order: input(description) → inputAuthor() → select(pkgMgr) → checkbox(dbFeatures)
//               → checkbox(otherFeatures) → confirm(apiEnabled) → [input(apiVersion)] → select(scm)
function stubPrompts({
  description = 'My API',
  author = 'Test Author',
  pkgMgr = 'yarn',
  dbFeatures = ['mongodb'],
  otherFeatures = ['docker'],
  apiEnabled = false,
  apiVersion = '1',
  scm = 'github',
}: {
  description?: string;
  author?: string;
  pkgMgr?: string;
  dbFeatures?: string[];
  otherFeatures?: string[];
  apiEnabled?: boolean;
  apiVersion?: string;
  scm?: string;
} = {}) {
  vi.mocked(input).mockResolvedValueOnce(description);
  vi.mocked(inputAuthor).mockResolvedValueOnce(author);
  vi.mocked(select).mockResolvedValueOnce(pkgMgr).mockResolvedValueOnce(scm);
  vi.mocked(checkbox).mockResolvedValueOnce(dbFeatures).mockResolvedValueOnce(otherFeatures);
  vi.mocked(confirm).mockResolvedValueOnce(apiEnabled);
  if (apiEnabled) {
    vi.mocked(input).mockResolvedValueOnce(apiVersion);
  }
}

describe('generate server', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(inputAuthor).mockResolvedValue('Default Author');
    (GenerateDocker as any).run.mockResolvedValue(undefined);
    (GenerateHelm as any).run.mockResolvedValue(undefined);
    (GenerateReact as any).run.mockResolvedValue(undefined);
    (GenerateDefaultRoute as any).run.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds the correct base context from prompts', async () => {
    stubPrompts({ description: 'My service', author: 'Alice', pkgMgr: 'npm', dbFeatures: [], otherFeatures: [], scm: 'git' });
    await GenerateServer.run(['my-service', '--output-dir', '/tmp/server-out'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect(context).toMatchObject({
      project_name: 'my-service',
      description: 'My service',
      author: 'Alice',
      year: new Date().getFullYear(),
      apiRoute: false,
      apiVersion: undefined,
    });
  });

  it('maps selected database and feature choices to boolean flags on context.features', async () => {
    stubPrompts({ dbFeatures: ['mongodb', 'redis'], otherFeatures: ['docker', 'react'] });
    await GenerateServer.run(['my-api', '--output-dir', '/tmp/server-out'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect((context as Record<string, Record<string, boolean>>).features).toMatchObject({
      mongodb: true,
      redis: true,
      docker: true,
      react: true,
      postgresql: false,
      sqlite: false,
      electron: false,
      k8s: false,
      hasDatabase: true,
    });
  });

  it('sets hasDatabase true when any persistent store is selected', async () => {
    for (const db of ['mongodb', 'postgresql', 'sqlite']) {
      vi.clearAllMocks();
      vi.mocked(processTemplate).mockResolvedValue(undefined);
      vi.mocked(inputAuthor).mockResolvedValue('Default Author');
      (GenerateDocker as any).run.mockResolvedValue(undefined);
      (GenerateHelm as any).run.mockResolvedValue(undefined);
      (GenerateReact as any).run.mockResolvedValue(undefined);
      (GenerateDefaultRoute as any).run.mockResolvedValue(undefined);
      stubPrompts({ dbFeatures: [db], otherFeatures: [] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/server-out'], ROOT);
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context as Record<string, Record<string, boolean>>).features.hasDatabase).toBe(true);
    }
  });

  it('sets hasDatabase false when only non-persistent features are selected', async () => {
    stubPrompts({ dbFeatures: ['redis'], otherFeatures: ['docker'] });
    await GenerateServer.run(['my-api', '--output-dir', '/tmp/server-out'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect((context as Record<string, Record<string, boolean>>).features).toMatchObject({
      redis: true,
      mongodb: false,
      postgresql: false,
      sqlite: false,
      hasDatabase: false,
    });
  });

  it('sets hasSqlDatastore true when postgresql or sqlite is selected', async () => {
    for (const db of ['postgresql', 'sqlite']) {
      vi.clearAllMocks();
      vi.mocked(processTemplate).mockResolvedValue(undefined);
      vi.mocked(inputAuthor).mockResolvedValue('Default Author');
      (GenerateDocker as any).run.mockResolvedValue(undefined);
      (GenerateHelm as any).run.mockResolvedValue(undefined);
      (GenerateReact as any).run.mockResolvedValue(undefined);
      (GenerateDefaultRoute as any).run.mockResolvedValue(undefined);
      stubPrompts({ dbFeatures: [db], otherFeatures: [] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/server-out'], ROOT);
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context as Record<string, Record<string, boolean>>).features.hasSqlDatastore).toBe(true);
    }
  });

  it('sets hasSqlDatastore false when mongodb or redis is selected without a SQL store', async () => {
    stubPrompts({ dbFeatures: ['mongodb', 'redis'], otherFeatures: [] });
    await GenerateServer.run(['my-api', '--output-dir', '/tmp/server-out'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect((context as Record<string, Record<string, boolean>>).features.hasSqlDatastore).toBe(false);
  });

  it('maps the SCM choice to a boolean map on context.scm', async () => {
    stubPrompts({ scm: 'github' });
    await GenerateServer.run(['my-api', '--output-dir', '/tmp/server-out'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect((context as Record<string, Record<string, boolean>>).scm).toMatchObject({
      github: true,
      gitlab: false,
      p4: false,
      svn: false,
    });
  });

  it('sets scm.git and scm.gitlab true when scm is "gitlab"', async () => {
    stubPrompts({ scm: 'gitlab' });
    await GenerateServer.run(['my-api', '--output-dir', '/tmp/server-out'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect((context as Record<string, Record<string, boolean>>).scm).toMatchObject({
      git: true,
      github: false,
      gitlab: true,
      p4: false,
      svn: false,
    });
  });

  it('maps the package manager choice to a boolean map on context.pkgMgr', async () => {
    stubPrompts({ pkgMgr: 'yarn' });
    await GenerateServer.run(['my-api', '--output-dir', '/tmp/server-out'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect((context as Record<string, Record<string, boolean>>).pkgMgr).toMatchObject({
      yarn: true,
      npm: false,
    });
  });

  it('uses ./<name> as the default output directory', async () => {
    stubPrompts();
    await GenerateServer.run(['my-project'], ROOT);

    const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
    expect(outputDir).toBe(join(process.cwd(), 'my-project'));
  });

  it('uses --output-dir when provided', async () => {
    stubPrompts();
    await GenerateServer.run(['my-api', '--output-dir', '/custom/path'], ROOT);

    const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
    expect(outputDir).toBe('/custom/path');
  });

  it('points processTemplate at the server template directory', async () => {
    stubPrompts();
    await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

    const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
    expect(templateDir).toContain(join('templates', 'server'));
  });

  it('passes force: true when --force is set', async () => {
    stubPrompts();
    await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--force'], ROOT);

    const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
    expect(opts).toMatchObject({ force: true });
  });

  describe('api flag', () => {
    it('sets apiRoute: false and apiVersion: undefined when the api prefix prompt is declined', async () => {
      stubPrompts({ apiEnabled: false });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.apiRoute).toBe(false);
      expect(context.apiVersion).toBeUndefined();
    });

    it('sets apiRoute: true and apiVersion from the follow-up prompt when confirmed', async () => {
      stubPrompts({ apiEnabled: true, apiVersion: '2' });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.apiRoute).toBe(true);
      expect(context.apiVersion).toBe('2');
    });
  });

  describe('default routes subcommand', () => {
    it('does not call GenerateDefaultRoute when no route-* features are selected', async () => {
      stubPrompts({ otherFeatures: ['docker'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDefaultRoute as any).run).not.toHaveBeenCalled();
    });

    it('calls GenerateDefaultRoute once with a --type per selected route-* feature', async () => {
      stubPrompts({ author: 'Test Author', otherFeatures: ['route-acl', 'route-admin', 'docker'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledOnce();
      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--author', 'Test Author', '--type', 'acl', '--type', 'admin', '--no-api-route'],
        expect.any(String),
      );
    });

    it('passes --force to GenerateDefaultRoute when --force is set on the server command', async () => {
      stubPrompts({ author: 'Test Author', otherFeatures: ['route-status'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--force'], ROOT);

      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--author', 'Test Author', '--type', 'status', '--force', '--no-api-route'],
        expect.any(String),
      );
    });

    it('passes --api-route --api to GenerateDefaultRoute when the api prefix prompt was confirmed', async () => {
      stubPrompts({ author: 'Test Author', otherFeatures: ['route-metrics'], apiEnabled: true, apiVersion: '3' });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--author', 'Test Author', '--type', 'metrics', '--api-route', '--api', '3'],
        expect.any(String),
      );
    });

    it('passes --no-api-route to GenerateDefaultRoute when the api prefix prompt was declined', async () => {
      stubPrompts({ author: 'Test Author', otherFeatures: ['route-metrics'], apiEnabled: false });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--author', 'Test Author', '--type', 'metrics', '--no-api-route'],
        expect.any(String),
      );
    });

    it('uses the default output directory (./<name>) when --output-dir is not set', async () => {
      stubPrompts({ author: 'Test Author', otherFeatures: ['route-push'] });
      await GenerateServer.run(['my-project'], ROOT);

      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
        ['--output-dir', join(process.cwd(), 'my-project'), '--author', 'Test Author', '--type', 'push', '--no-api-route'],
        expect.any(String),
      );
    });
  });

  describe('author resolution', () => {
    it('calls inputAuthor and uses its return value as the author', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author <git@example.com>');
      vi.mocked(input).mockResolvedValueOnce('My API');
      vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
      vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author <git@example.com>');
      expect(inputAuthor).toHaveBeenCalledOnce();
    });

    it('--author skips inputAuthor and uses the flag value', async () => {
      vi.mocked(input).mockResolvedValueOnce('My API');
      vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
      vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
    });

    it('passes the resolved author through to GenerateDefaultRoute for selected route-* features', async () => {
      vi.mocked(input).mockResolvedValueOnce('My API');
      vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
      vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['route-acl']);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--author', 'Flag Author'], ROOT);

      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--author', 'Flag Author', '--type', 'acl', '--no-api-route'],
        expect.any(String),
      );
    });
  });

  describe('docker subcommand', () => {
    it('runs GenerateDocker with --output-dir after server generation when docker is selected', async () => {
      stubPrompts({ otherFeatures: ['docker'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledOnce();
      expect((GenerateDocker as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--no-has-react'],
        expect.any(String),
      );
    });

    it('does not run GenerateDocker when docker is not selected', async () => {
      stubPrompts({ otherFeatures: [] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDocker as any).run).not.toHaveBeenCalled();
    });

    it('passes --force to GenerateDocker when --force is set on the server command', async () => {
      stubPrompts({ otherFeatures: ['docker'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--force'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--force', '--no-has-react'],
        expect.any(String),
      );
    });

    it('uses the default output directory (./<name>) when --output-dir is not set', async () => {
      stubPrompts({ otherFeatures: ['docker'] });
      await GenerateServer.run(['my-project'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledWith(
        ['--output-dir', join(process.cwd(), 'my-project'), '--no-has-react'],
        expect.any(String),
      );
    });

    it('passes --has-react to GenerateDocker when react is also selected', async () => {
      stubPrompts({ otherFeatures: ['docker', 'react'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--has-react'],
        expect.any(String),
      );
    });
  });

  describe('helm subcommand', () => {
    it('runs GenerateHelm with --output-dir after server generation when k8s is selected', async () => {
      stubPrompts({ otherFeatures: ['k8s'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateHelm as any).run).toHaveBeenCalledOnce();
      expect((GenerateHelm as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--no-install'],
        expect.any(String),
      );
    });

    it('does not run GenerateHelm when k8s is not selected', async () => {
      stubPrompts({ otherFeatures: [] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateHelm as any).run).not.toHaveBeenCalled();
    });

    it('passes --force to GenerateHelm when --force is set on the server command', async () => {
      stubPrompts({ otherFeatures: ['k8s'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--force'], ROOT);

      expect((GenerateHelm as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--force', '--no-install'],
        expect.any(String),
      );
    });

    it('uses the default output directory (./<name>) when --output-dir is not set', async () => {
      stubPrompts({ otherFeatures: ['k8s'] });
      await GenerateServer.run(['my-project'], ROOT);

      expect((GenerateHelm as any).run).toHaveBeenCalledWith(
        ['--output-dir', join(process.cwd(), 'my-project'), '--no-install'],
        expect.any(String),
      );
    });

    it('runs both GenerateDocker and GenerateHelm when both features are selected', async () => {
      stubPrompts({ otherFeatures: ['docker', 'k8s'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledOnce();
      expect((GenerateHelm as any).run).toHaveBeenCalledOnce();
    });
  });

  describe('react subcommand', () => {
    it('runs GenerateReact with --output-dir after server generation when react is selected', async () => {
      stubPrompts({ otherFeatures: ['react'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateReact as any).run).toHaveBeenCalledOnce();
      expect((GenerateReact as any).run).toHaveBeenCalledWith(
        ['app', '--output-dir', '/tmp/out', '--no-install'],
        expect.any(String),
      );
    });

    it('does not run GenerateReact when react is not selected', async () => {
      stubPrompts({ otherFeatures: [] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateReact as any).run).not.toHaveBeenCalled();
    });

    it('passes --force to GenerateReact when --force is set on the server command', async () => {
      stubPrompts({ otherFeatures: ['react'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--force'], ROOT);

      expect((GenerateReact as any).run).toHaveBeenCalledWith(
        ['app', '--output-dir', '/tmp/out', '--force', '--no-install'],
        expect.any(String),
      );
    });

    it('uses the default output directory (./<name>) when --output-dir is not set', async () => {
      stubPrompts({ otherFeatures: ['react'] });
      await GenerateServer.run(['my-project'], ROOT);

      expect((GenerateReact as any).run).toHaveBeenCalledWith(
        ['app', '--output-dir', join(process.cwd(), 'my-project'), '--no-install'],
        expect.any(String),
      );
    });

    it('runs docker, helm, react, and default-route subcommands when all are selected', async () => {
      stubPrompts({ otherFeatures: ['docker', 'k8s', 'react', 'route-openapi'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledOnce();
      expect((GenerateHelm as any).run).toHaveBeenCalledOnce();
      expect((GenerateReact as any).run).toHaveBeenCalledOnce();
      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledOnce();
    });
  });

  describe('non-interactive flags', () => {
    it('--description skips the description prompt', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
      vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--description', 'From flag'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.description).toBe('From flag');
      expect(input).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('description') }));
    });

    it('--pkg-manager skips the package manager select', async () => {
      vi.mocked(input).mockResolvedValueOnce('desc');
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce('github'); // scm only — pkgMgr select skipped
      vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--pkg-manager', 'npm'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context as any).pkgMgr).toMatchObject({ npm: true, yarn: false });
    });

    it('rejects an invalid --pkg-manager value', async () => {
      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--pkg-manager', 'bun'], ROOT),
      ).rejects.toThrow(/Invalid package manager "bun"/);
    });

    it('--db skips the database checkbox', async () => {
      vi.mocked(input).mockResolvedValueOnce('desc');
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
      vi.mocked(checkbox).mockResolvedValueOnce(['docker']); // otherFeatures only — db checkbox skipped
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--db', 'postgresql', '--db', 'redis'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context as any).features).toMatchObject({ postgresql: true, redis: true, mongodb: false, sqlite: false });
    });

    it('rejects an invalid --db value', async () => {
      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--db', 'oracle'], ROOT),
      ).rejects.toThrow(/Invalid database feature "oracle"/);
    });

    it('pluralizes the error message when multiple invalid --db values are given', async () => {
      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--db', 'oracle', '--db', 'mysql'], ROOT),
      ).rejects.toThrow(/Invalid database features "oracle, mysql"/);
    });

    describe('grouped feature flags (route/react/docker/k8s)', () => {
      async function runWithFeatureFlags(extraArgs: string[]) {
        vi.mocked(input).mockResolvedValueOnce('desc');
        vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
        vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
        vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']); // db checkbox only — otherFeatures checkbox skipped
        vi.mocked(confirm).mockResolvedValueOnce(false);
        await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', ...extraArgs], ROOT);
      }

      it('skips the "additional features" checkbox entirely when any one of the four flags is present', async () => {
        await runWithFeatureFlags(['--react']);
        expect(checkbox).toHaveBeenCalledTimes(1); // db only
      });

      it('--route sets the selected routes and defaults react/k8s off, docker on', async () => {
        await runWithFeatureFlags(['--route', 'admin', '--route', 'status']);

        expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
          ['--output-dir', '/tmp/out', '--author', 'Author', '--type', 'admin', '--type', 'status', '--no-api-route'],
          expect.any(String),
        );
        const [, , context] = vi.mocked(processTemplate).mock.calls[0];
        expect((context as any).features).toMatchObject({ react: false, docker: true, k8s: false });
      });

      it('rejects an invalid --route value', async () => {
        await expect(
          GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--route', 'bogus'], ROOT),
        ).rejects.toThrow(/Invalid route type "bogus"/);
      });

      it('--react alone defaults route to empty and docker to true (the checkbox default)', async () => {
        await runWithFeatureFlags(['--react']);

        expect((GenerateDefaultRoute as any).run).not.toHaveBeenCalled();
        const [, , context] = vi.mocked(processTemplate).mock.calls[0];
        expect((context as any).features).toMatchObject({ react: true, docker: true, k8s: false });
      });

      it('--no-docker explicitly turns docker off instead of using its default-true fallback', async () => {
        await runWithFeatureFlags(['--react', '--no-docker']);

        expect((GenerateDocker as any).run).not.toHaveBeenCalled();
        const [, , context] = vi.mocked(processTemplate).mock.calls[0];
        expect((context as any).features.docker).toBe(false);
      });

      it('--k8s alone enables k8s and still defaults docker to true', async () => {
        await runWithFeatureFlags(['--k8s']);

        expect((GenerateHelm as any).run).toHaveBeenCalledOnce();
        expect((GenerateDocker as any).run).toHaveBeenCalledOnce();
      });
    });

    describe('--api-route / --api-version', () => {
      it('--api-route with --api-version sets both without prompting', async () => {
        vi.mocked(input).mockResolvedValueOnce('desc');
        vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
        vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
        vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);

        await GenerateServer.run(
          ['my-api', '--output-dir', '/tmp/out', '--api-route', '--api-version', '2'],
          ROOT,
        );

        const [, , context] = vi.mocked(processTemplate).mock.calls[0];
        expect(context.apiRoute).toBe(true);
        expect(context.apiVersion).toBe('2');
        expect(confirm).not.toHaveBeenCalled();
      });

      it('--api-route without --api-version resolves to an empty-string version (no version segment)', async () => {
        vi.mocked(input).mockResolvedValueOnce('desc');
        vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
        vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
        vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['route-status']);

        await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--api-route'], ROOT);

        const [, , context] = vi.mocked(processTemplate).mock.calls[0];
        expect(context.apiRoute).toBe(true);
        expect(context.apiVersion).toBe('');
        expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
          ['--output-dir', '/tmp/out', '--author', 'Author', '--type', 'status', '--api-route', '--api', ''],
          expect.any(String),
        );
      });

      it('--no-api-route sets apiRoute false without prompting, even though api-version was not given', async () => {
        vi.mocked(input).mockResolvedValueOnce('desc');
        vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
        vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
        vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);

        await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--no-api-route'], ROOT);

        const [, , context] = vi.mocked(processTemplate).mock.calls[0];
        expect(context.apiRoute).toBe(false);
        expect(context.apiVersion).toBeUndefined();
        expect(confirm).not.toHaveBeenCalled();
      });
    });

    it('--scm skips the SCM select', async () => {
      vi.mocked(input).mockResolvedValueOnce('desc');
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce('yarn'); // pkgMgr only — scm select skipped
      vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--scm', 'gitlab'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect((context as any).scm).toMatchObject({ gitlab: true, github: false, git: true });
    });

    it('--scm none maps to an empty repository/scm prefix, matching the interactive "(none)" choice', async () => {
      vi.mocked(input).mockResolvedValueOnce('desc');
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');
      vi.mocked(select).mockResolvedValueOnce('yarn');
      vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--scm', 'none'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.repository).toBe('/my-api');
      expect((context as any).scm).toMatchObject({ git: false, github: false, gitlab: false });
    });

    it('rejects an invalid --scm value', async () => {
      stubPrompts();
      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--scm', 'cvs'], ROOT),
      ).rejects.toThrow(/Invalid SCM "cvs"/);
    });
  });

  describe('--answers file', () => {
    let answersDir: string;

    beforeEach(async () => {
      answersDir = await mkdtemp(join(os.tmpdir(), 'rr-answers-'));
    });

    afterEach(async () => {
      await rm(answersDir, { recursive: true, force: true });
    });

    async function writeAnswers(data: Record<string, unknown>): Promise<string> {
      const path = join(answersDir, 'answers.json');
      await writeFile(path, JSON.stringify(data), 'utf-8');
      return path;
    }

    it('applies every field from the file without prompting for any of them', async () => {
      const path = await writeAnswers({
        description: 'From file', author: 'File Author', pkgManager: 'npm',
        db: ['sqlite'], route: ['acl'], react: true, docker: false, k8s: true,
        apiRoute: true, apiVersion: '1', scm: 'gitlab',
      });

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT);

      expect(input).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      expect(checkbox).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(inputAuthor).not.toHaveBeenCalled();

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ description: 'From file', author: 'File Author', apiRoute: true, apiVersion: '1' });
      expect((context as any).pkgMgr).toMatchObject({ npm: true });
      expect((context as any).features).toMatchObject({ sqlite: true, react: true, docker: false, k8s: true });
      expect((context as any).scm).toMatchObject({ gitlab: true });
      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--author', 'File Author', '--type', 'acl', '--api-route', '--api', '1'],
        expect.any(String),
      );
    });

    it('an explicit flag overrides the same field in the answers file', async () => {
      const path = await writeAnswers({
        description: 'From file', author: 'File Author', pkgManager: 'npm', db: ['mongodb'],
        docker: true, apiRoute: false, scm: 'github',
      });

      await GenerateServer.run(
        ['my-api', '--output-dir', '/tmp/out', '--answers', path, '--description', 'From flag'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.description).toBe('From flag');
      expect(context.author).toBe('File Author'); // still comes from the file
    });

    it('falls through to the interactive prompt for any field the file omits', async () => {
      const path = await writeAnswers({ description: 'From file' });
      vi.mocked(inputAuthor).mockResolvedValueOnce('Prompted Author');
      vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
      vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.description).toBe('From file');
      expect(context.author).toBe('Prompted Author');
      expect(input).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('description') }));
    });

    it('a db/route array in the file is treated the same as the flag being present (skips the checkbox)', async () => {
      const path = await writeAnswers({ description: 'd', author: 'a', pkgManager: 'npm', db: ['mongodb'], route: ['status'], scm: 'github' });

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT);

      expect(checkbox).not.toHaveBeenCalled();
      expect((GenerateDefaultRoute as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out', '--author', 'a', '--type', 'status', '--no-api-route'],
        expect.any(String),
      );
    });

    it('errors clearly when the file does not exist', async () => {
      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', join(answersDir, 'missing.json')], ROOT),
      ).rejects.toThrow(/Could not read --answers file/);
    });

    it('errors clearly on invalid JSON', async () => {
      const path = join(answersDir, 'bad.json');
      await writeFile(path, '{ not valid json', 'utf-8');

      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT),
      ).rejects.toThrow(/not valid JSON/);
    });

    it('errors clearly when the file is valid JSON but not an object (e.g. an array)', async () => {
      const path = join(answersDir, 'array.json');
      await writeFile(path, '[1, 2, 3]', 'utf-8');

      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT),
      ).rejects.toThrow(/must contain a JSON object/);
    });

    it('errors clearly when a string field has the wrong type', async () => {
      const path = await writeAnswers({ description: 123 });

      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT),
      ).rejects.toThrow(/"description" must be a string/);
    });

    it('errors clearly when an array field has the wrong type', async () => {
      const path = await writeAnswers({ db: 'mongodb' });

      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT),
      ).rejects.toThrow(/"db" must be an array of strings/);
    });

    it('errors clearly when an array field contains a non-string element', async () => {
      const path = await writeAnswers({ db: ['mongodb', 42] });

      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT),
      ).rejects.toThrow(/"db" must be an array of strings/);
    });

    it('errors clearly when a boolean field has the wrong type', async () => {
      const path = await writeAnswers({ react: 'yes' });

      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT),
      ).rejects.toThrow(/"react" must be a boolean/);
    });

    it('validates an enum value sourced from the file the same way as from a flag', async () => {
      const path = await writeAnswers({ pkgManager: 'bun' });

      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT),
      ).rejects.toThrow(/Invalid package manager "bun"/);
    });

    it('ignores unknown keys in the file rather than rejecting them', async () => {
      const path = await writeAnswers({
        description: 'd', author: 'a', pkgManager: 'npm', db: ['mongodb'],
        docker: true, apiRoute: false, scm: 'github', somethingUnrelated: true,
      });

      await expect(
        GenerateServer.run(['my-api', '--output-dir', '/tmp/out', '--answers', path], ROOT),
      ).resolves.toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('propagates an error thrown by processTemplate', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue(new Error('template boom'));

      await expect(
        GenerateServer.run(['my-service', '--output-dir', '/tmp/server-out'], ROOT),
      ).rejects.toThrow('template boom');
    });

    it('falls back to String(err) when processTemplate rejects with a non-Error value', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue('non-error-boom');

      await expect(
        GenerateServer.run(['my-service', '--output-dir', '/tmp/server-out'], ROOT),
      ).rejects.toThrow('non-error-boom');
    });
  });
});
