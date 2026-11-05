///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  findExistingReactApps: vi.fn(),
  readProjectName: vi.fn(),
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

import { confirm } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { findExistingReactApps, readProjectName } from '../../../src/lib/project.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import GenerateReactPage from '../../../src/commands/generate/react-page.js';

const ROOT = process.cwd();

// Default prompt order (no flags): inputAuthor(cwd) → confirm(service)
function stubPrompts({
  service = true,
  author,
}: {
  service?: boolean;
  author?: string;
} = {}) {
  vi.mocked(confirm).mockResolvedValueOnce(service);
  if (author !== undefined) vi.mocked(inputAuthor).mockResolvedValueOnce(author);
}

describe('generate react-page', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(inputAuthor).mockResolvedValue('Default Author');
    vi.mocked(readProjectName).mockResolvedValue('my-app');
    vi.mocked(findExistingReactApps).mockResolvedValue([
      { routeFile: 'src/routes/AppRoute.ts', className: 'AppRoute', appDir: 'apps/app', routePath: '/app', router: false },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('context building', () => {
    it('builds the correct context from prompts and passes it to processTemplate', async () => {
      stubPrompts({ service: true, author: 'Jane Doe' });
      await GenerateReactPage.run(['app', 'Dashboard'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        app: 'app',
        name: 'Dashboard',
        className: 'Dashboard',
        service: true,
        author: 'Jane Doe',
        project_name: 'my-app',
        year: new Date().getFullYear(),
      });
    });

    it('includes service: false when the service prompt answers no', async () => {
      stubPrompts({ service: false, author: 'Author' });
      await GenerateReactPage.run(['app', 'Dashboard'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.service).toBe(false);
    });

    it('includes project_name from the project config in the context', async () => {
      vi.mocked(readProjectName).mockResolvedValue('another-app');
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run(['app', 'Dashboard'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.project_name).toBe('another-app');
      expect(readProjectName).toHaveBeenCalledWith(process.cwd());
    });
  });

  describe('@ReactService path (the page\'s public URL)', () => {
    async function servicePathFor(app: string, page: string): Promise<unknown> {
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run([app, page], ROOT);
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      return context.servicePath;
    }

    it('prefixes the page path with the app route\'s mount path', async () => {
      expect(await servicePathFor('app', 'my/path/page')).toBe('/app/my/path/page');
    });

    it('uses the mount path, not the app name, when they differ', async () => {
      vi.mocked(findExistingReactApps).mockResolvedValue([
        { routeFile: 'src/routes/AdminRoute.ts', className: 'AdminRoute', appDir: 'apps/admin', routePath: '/console/*', router: false },
      ]);
      expect(await servicePathFor('admin', 'users')).toBe('/console/users');
    });

    it('drops the prefix for an app mounted at the root', async () => {
      vi.mocked(findExistingReactApps).mockResolvedValue([
        { routeFile: 'src/routes/WwwRoute.ts', className: 'WwwRoute', appDir: './apps/www', routePath: '/', router: false },
      ]);
      expect(await servicePathFor('www', '/about/')).toBe('/about');
    });

    it('warns and assumes /<app> when no route for the app is found', async () => {
      vi.mocked(findExistingReactApps).mockResolvedValue([]);
      const warn = vi.spyOn(GenerateReactPage.prototype, 'warn').mockImplementation(() => undefined as any);
      expect(await servicePathFor('app', 'Dashboard')).toBe('/app/Dashboard');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('No ReactRoute found for apps/app'));
      warn.mockRestore();
    });
  });

  describe('className derivation from a (possibly nested) page path', () => {
    it('keeps name as the raw path but PascalCases className for a nested path', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run(['app', 'my/path/page'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.name).toBe('my/path/page');
      expect(context.className).toBe('MyPathPage');
    });

    it('capitalizes a single lowercase segment', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run(['app', 'dashboard'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.className).toBe('Dashboard');
    });

    it('joins hyphen- and underscore-separated words within a segment', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run(['app', 'my-cool/page_two'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.className).toBe('MyCoolPageTwo');
    });
  });

  describe('flag shortcuts bypass prompts', () => {
    it('--service skips the service confirm prompt', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');

      await GenerateReactPage.run(['app', 'Dashboard', '--service'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.service).toBe(true);
      expect(vi.mocked(confirm)).not.toHaveBeenCalled();
    });

    it('--no-service skips the service confirm prompt', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');

      await GenerateReactPage.run(['app', 'Dashboard', '--no-service'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.service).toBe(false);
      expect(vi.mocked(confirm)).not.toHaveBeenCalled();
    });

    it('--author skips inputAuthor entirely', async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false);

      await GenerateReactPage.run(['app', 'Dashboard', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
    });
  });

  describe('author resolution', () => {
    it('calls inputAuthor with the project cwd and uses its return value', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author <git@example.com>');
      stubPrompts();

      await GenerateReactPage.run(['app', 'Dashboard'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author <git@example.com>');
      expect(inputAuthor).toHaveBeenCalledWith(process.cwd());
    });
  });

  describe('output and template options', () => {
    it('uses process.cwd() as the default output directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run(['app', 'Dashboard'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(ROOT);
    });

    it('uses --output-dir when provided', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run(['app', 'Dashboard', '--output-dir', '/custom/path'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe('/custom/path');
    });

    it('passes force: true to processTemplate when --force is set', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run(['app', 'Dashboard', '--force'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: true });
    });

    it('passes projectDir: process.cwd() to processTemplate', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run(['app', 'Dashboard'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ projectDir: ROOT });
    });

    it('points processTemplate at the react-page template directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateReactPage.run(['app', 'Dashboard'], ROOT);

      const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(templateDir).toContain(join('templates', 'react-page'));
    });
  });

  describe('error handling', () => {
    it('propagates an error thrown by processTemplate', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue(new Error('template boom'));

      await expect(
        GenerateReactPage.run(['app', 'Dashboard'], ROOT),
      ).rejects.toThrow('template boom');
    });

    it('falls back to String(err) when processTemplate rejects with a non-Error value', async () => {
      stubPrompts();
      vi.mocked(processTemplate).mockRejectedValue('non-error-boom');

      await expect(
        GenerateReactPage.run(['app', 'Dashboard'], ROOT),
      ).rejects.toThrow('non-error-boom');
    });
  });
});
