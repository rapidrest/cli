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
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

import { input, select, confirm } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { readProjectName } from '../../../src/lib/project.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
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
