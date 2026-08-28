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
}));

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  readGitAuthor: vi.fn(),
  readProjectAuthor: vi.fn(),
  readProjectName: vi.fn(),
  findExistingReactApps: vi.fn(),
  installIfPackageJsonChanged: vi.fn(),
  readPackageJsonRaw: vi.fn(),
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
  readFile: vi.fn(),
}));

import { input, select, confirm } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { findExistingReactApps, readProjectName } from '../../../src/lib/project.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import { writeFile, mkdir, rename, readFile } from 'fs/promises';
import GenerateReact from '../../../src/commands/generate/react.js';

const ROOT = process.cwd();

// Default prompt order (no flags):
//   input(path) → confirm(hydrate) → inputAuthor(cwd)
function stubPrompts({
  path = '/app',
  hydrate = false,
  author,
}: {
  path?: string;
  hydrate?: boolean;
  author?: string;
} = {}) {
  vi.mocked(input).mockResolvedValueOnce(path);
  vi.mocked(confirm).mockResolvedValueOnce(hydrate);
  if (author !== undefined) vi.mocked(inputAuthor).mockResolvedValueOnce(author);
}

describe('generate react', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(inputAuthor).mockResolvedValue('Default Author');
    vi.mocked(readProjectName).mockResolvedValue('my-app');
    vi.mocked(findExistingReactApps).mockResolvedValue([]);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(readFile).mockResolvedValue('');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('context building', () => {
    it('builds the correct context from prompts and passes it to processTemplate', async () => {
      stubPrompts({ path: '/my-react-app', hydrate: true, author: 'Jane Doe' });
      await GenerateReact.run(['app'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        name: 'app',
        path: '/my-react-app',
        hydrate: true,
        author: 'Jane Doe',
        year: new Date().getFullYear(),
        project_name: 'my-app',
      });
    });

    it('includes hydrate: false when the hydrate select answers no', async () => {
      stubPrompts({ hydrate: false, author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hydrate).toBe(false);
    });

    it('includes project_name from package.json in the context', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.project_name).toBe('my-app');
    });

    it('uses the app name as the default suggestion for the path prompt', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['dashboard'], ROOT);

      const pathInputCall = vi.mocked(input).mock.calls[0][0] as any;
      expect(pathInputCall.default).toBe('/dashboard');
    });
  });

  describe('flag shortcuts bypass prompts', () => {
    it('--path skips the path input prompt', async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateReact.run(['app', '--path', '/fixed-path'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.path).toBe('/fixed-path');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(0); // path from flag, hydrate via confirm
    });

    it('--hydrate skips the hydrate confirm prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('/app');

      await GenerateReact.run(['app', '--hydrate'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hydrate).toBe(true);
      expect(vi.mocked(confirm)).not.toHaveBeenCalled();
    });

    it('--author skips inputAuthor entirely', async () => {
      vi.mocked(input).mockResolvedValueOnce('/app');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateReact.run(['app', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // path only
    });
  });

  describe('author resolution', () => {
    it('calls inputAuthor with the project cwd and uses its return value', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author <git@example.com>');
      stubPrompts();

      await GenerateReact.run(['app'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author <git@example.com>');
      expect(inputAuthor).toHaveBeenCalledWith(process.cwd());
    });
  });

  describe('output and template options', () => {
    it('uses the project root as the default output directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(ROOT);
    });

    it('passes force: true to processTemplate when --force is set', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app', '--force'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: true });
    });

    it('passes projectDir: process.cwd() to processTemplate', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ projectDir: ROOT });
    });

    it('points processTemplate at the react template directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(templateDir).toContain(join('templates', 'react'));
    });
  });

  describe('vite.config.ts / tsconfig.client.json generation', () => {
    it('writes a single-app vite.config.ts when this is the only app', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      const call = vi.mocked(writeFile).mock.calls.find(([p]) => String(p).endsWith('vite.config.ts'));
      expect(call).toBeDefined();
      expect(call![1]).toContain('appDir: "apps/app"');
      expect(call![1]).not.toContain('[');
    });

    it('writes an array-form vite.config.ts covering every existing app plus the new one', async () => {
      vi.mocked(findExistingReactApps).mockResolvedValue([
        { routeFile: 'src/routes/WwwRoute.ts', className: 'WwwRoute', appDir: 'apps/www', routePath: '/' },
      ]);
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['admin'], ROOT);

      const call = vi.mocked(writeFile).mock.calls.find(([p]) => String(p).endsWith('vite.config.ts'));
      expect(call![1]).toContain('appDir: ["apps/www", "apps/admin"]');
    });

    it('writes tsconfig.client.json with a broad "apps" include', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      const call = vi.mocked(writeFile).mock.calls.find(([p]) => String(p).endsWith('tsconfig.client.json'));
      expect(call).toBeDefined();
      const content = JSON.parse(call![1] as string);
      expect(content.include).toEqual(['apps']);
      expect(content.extends).toBe('@rapidrest/react/tsconfig/client');
    });
  });

  describe('src/export.ts generation', () => {
    const exportEntry = () =>
      vi.mocked(writeFile).mock.calls.find(([p]) => String(p).endsWith('export.ts'));

    it('uses the flat appDir/routePrefix form when this is the only app', async () => {
      stubPrompts({ path: '/app', author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      const call = exportEntry();
      expect(call).toBeDefined();
      const content = call![1] as string;
      expect(content).toContain('import { runStaticExport } from "@rapidrest/react";');
      expect(content).toContain('{ appDir: "apps/app", routePrefix: "/app" }');
      expect(content).not.toContain('apps: [');
    });

    it('uses "" instead of "/" for a single app mounted at the site root', async () => {
      stubPrompts({ path: '/', author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      const content = exportEntry()![1] as string;
      expect(content).toContain('{ appDir: "apps/app", routePrefix: "" }');
    });

    it('switches to the multi-app `apps` array form covering every existing app plus the new one', async () => {
      vi.mocked(findExistingReactApps).mockResolvedValue([
        { routeFile: 'src/routes/WwwRoute.ts', className: 'WwwRoute', appDir: 'apps/www', routePath: '/' },
      ]);
      stubPrompts({ path: '/admin', author: 'Author' });
      await GenerateReact.run(['admin'], ROOT);

      const content = exportEntry()![1] as string;
      expect(content).toContain('apps: [');
      expect(content).toContain('{ appDir: "apps/www", routePrefix: "" }');
      expect(content).toContain('{ appDir: "apps/admin", routePrefix: "/admin" }');
    });

    it('substitutes the author and year into the copyright header', async () => {
      stubPrompts({ path: '/app', author: 'Jane Doe' });
      await GenerateReact.run(['app'], ROOT);

      const content = exportEntry()![1] as string;
      expect(content).toContain(`Copyright (C) ${new Date().getFullYear()} Jane Doe`);
    });
  });

  describe('single-app to multi-app migration', () => {
    it('does not migrate anything when no existing app uses the old layout', async () => {
      vi.mocked(findExistingReactApps).mockResolvedValue([
        { routeFile: 'src/routes/WwwRoute.ts', className: 'WwwRoute', appDir: 'apps/www', routePath: '/' },
      ]);
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['admin'], ROOT);

      expect(rename).not.toHaveBeenCalled();
    });

    it('migrates an app still on the old (non-namespaced) layout to apps/<name>/', async () => {
      vi.mocked(findExistingReactApps).mockResolvedValue([
        { routeFile: 'src/routes/AppRoute.ts', className: 'AppRoute', appDir: 'app', routePath: '/' },
      ]);
      vi.mocked(readFile).mockResolvedValue('appDir: string = "app";');
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app2'], ROOT);

      expect(mkdir).toHaveBeenCalledWith(join(ROOT, 'apps'), { recursive: true });
      expect(rename).toHaveBeenCalledWith(join(ROOT, 'app'), join(ROOT, 'apps', 'app'));
      const routeWrite = vi.mocked(writeFile).mock.calls.find(([p]) => String(p).endsWith('AppRoute.ts'));
      expect(routeWrite![1]).toContain('appDir: string = "apps/app";');
    });

    it('re-reads existing apps after migrating, so vite.config.ts uses the migrated appDir', async () => {
      vi.mocked(findExistingReactApps)
        .mockResolvedValueOnce([
          { routeFile: 'src/routes/AppRoute.ts', className: 'AppRoute', appDir: 'app', routePath: '/' },
        ])
        .mockResolvedValueOnce([
          { routeFile: 'src/routes/AppRoute.ts', className: 'AppRoute', appDir: 'apps/app', routePath: '/' },
        ]);
      vi.mocked(readFile).mockResolvedValue('appDir: string = "app";');
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app2'], ROOT);

      const call = vi.mocked(writeFile).mock.calls.find(([p]) => String(p).endsWith('vite.config.ts'));
      expect(call![1]).toContain('appDir: ["apps/app", "apps/app2"]');
      expect(findExistingReactApps).toHaveBeenCalledTimes(2);
    });

    it('does not call findExistingReactApps a second time when no migration was needed', async () => {
      vi.mocked(findExistingReactApps).mockResolvedValue([]);
      stubPrompts({ author: 'Author' });
      await GenerateReact.run(['app'], ROOT);

      expect(findExistingReactApps).toHaveBeenCalledTimes(1);
    });

    it('logs a migration message for each migrated app', async () => {
      vi.mocked(findExistingReactApps).mockResolvedValue([
        { routeFile: 'src/routes/AppRoute.ts', className: 'AppRoute', appDir: 'app', routePath: '/' },
      ]);
      const logSpy = vi.spyOn(GenerateReact.prototype, 'log').mockImplementation(() => undefined);
      stubPrompts({ author: 'Author' });
      try {
        await GenerateReact.run(['app2'], ROOT);
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Migrating existing app: app/ -> apps/app/'));
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('error handling', () => {
    it('propagates an error thrown by processTemplate', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue(new Error('template boom'));

      await expect(GenerateReact.run(['app'], ROOT)).rejects.toThrow('template boom');
    });

    it('falls back to String(err) when processTemplate rejects with a non-Error value', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue('non-error-boom');

      await expect(GenerateReact.run(['app'], ROOT)).rejects.toThrow('non-error-boom');
    });
  });
});
