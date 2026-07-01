import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
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

import { input, select, checkbox } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import GenerateDocker from '../../../src/commands/generate/docker.js';
import GenerateHelm from '../../../src/commands/generate/k8s.js';
import GenerateReact from '../../../src/commands/generate/react.js';
import GenerateServer from '../../../src/commands/generate/server.js';

const ROOT = process.cwd();

// Prompt order: input(description) → inputAuthor() → select(pkgMgr) → checkbox(dbFeatures)
//               → checkbox(otherFeatures) → select(scm)
function stubPrompts({
  description = 'My API',
  author = 'Test Author',
  pkgMgr = 'yarn',
  dbFeatures = ['mongodb'],
  otherFeatures = ['docker'],
  scm = 'github',
}: {
  description?: string;
  author?: string;
  pkgMgr?: string;
  dbFeatures?: string[];
  otherFeatures?: string[];
  scm?: string;
} = {}) {
  vi.mocked(input).mockResolvedValueOnce(description);
  vi.mocked(inputAuthor).mockResolvedValueOnce(author);
  vi.mocked(select).mockResolvedValueOnce(pkgMgr).mockResolvedValueOnce(scm);
  vi.mocked(checkbox).mockResolvedValueOnce(dbFeatures).mockResolvedValueOnce(otherFeatures);
}

describe('generate server', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(inputAuthor).mockResolvedValue('Default Author');
    (GenerateDocker as any).run.mockResolvedValue(undefined);
    (GenerateHelm as any).run.mockResolvedValue(undefined);
    (GenerateReact as any).run.mockResolvedValue(undefined);
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

  describe('author resolution', () => {
    it('calls inputAuthor and uses its return value as the author', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author <git@example.com>');
      vi.mocked(input).mockResolvedValueOnce('My API');
      vi.mocked(select).mockResolvedValueOnce('yarn').mockResolvedValueOnce('github');
      vi.mocked(checkbox).mockResolvedValueOnce(['mongodb']).mockResolvedValueOnce(['docker']);

      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author <git@example.com>');
      expect(inputAuthor).toHaveBeenCalledOnce();
    });
  });

  describe('docker subcommand', () => {
    it('runs GenerateDocker with --output-dir after server generation when docker is selected', async () => {
      stubPrompts({ otherFeatures: ['docker'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledOnce();
      expect((GenerateDocker as any).run).toHaveBeenCalledWith(
        ['--output-dir', '/tmp/out'],
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
        ['--output-dir', '/tmp/out', '--force'],
        expect.any(String),
      );
    });

    it('uses the default output directory (./<name>) when --output-dir is not set', async () => {
      stubPrompts({ otherFeatures: ['docker'] });
      await GenerateServer.run(['my-project'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledWith(
        ['--output-dir', join(process.cwd(), 'my-project')],
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
        ['--output-dir', '/tmp/out'],
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
        ['--output-dir', '/tmp/out', '--force'],
        expect.any(String),
      );
    });

    it('uses the default output directory (./<name>) when --output-dir is not set', async () => {
      stubPrompts({ otherFeatures: ['k8s'] });
      await GenerateServer.run(['my-project'], ROOT);

      expect((GenerateHelm as any).run).toHaveBeenCalledWith(
        ['--output-dir', join(process.cwd(), 'my-project')],
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
        ['app', '--output-dir', '/tmp/out'],
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
        ['app', '--output-dir', '/tmp/out', '--force'],
        expect.any(String),
      );
    });

    it('uses the default output directory (./<name>) when --output-dir is not set', async () => {
      stubPrompts({ otherFeatures: ['react'] });
      await GenerateServer.run(['my-project'], ROOT);

      expect((GenerateReact as any).run).toHaveBeenCalledWith(
        ['app', '--output-dir', join(process.cwd(), 'my-project')],
        expect.any(String),
      );
    });

    it('runs docker, helm, and react subcommands when all three features are selected', async () => {
      stubPrompts({ otherFeatures: ['docker', 'k8s', 'react'] });
      await GenerateServer.run(['my-api', '--output-dir', '/tmp/out'], ROOT);

      expect((GenerateDocker as any).run).toHaveBeenCalledOnce();
      expect((GenerateHelm as any).run).toHaveBeenCalledOnce();
      expect((GenerateReact as any).run).toHaveBeenCalledOnce();
    });
  });
});
