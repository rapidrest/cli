import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { input, select, checkbox } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import GenerateServer from '../../../src/commands/generate/server.js';

const ROOT = process.cwd();

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
  vi.mocked(input).mockResolvedValueOnce(description).mockResolvedValueOnce(author);
  vi.mocked(select).mockResolvedValueOnce(pkgMgr).mockResolvedValueOnce(scm);
  vi.mocked(checkbox).mockResolvedValueOnce(dbFeatures).mockResolvedValueOnce(otherFeatures);
}

describe('generate server', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
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
});
