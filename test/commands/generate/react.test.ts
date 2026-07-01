import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
}));

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  readProjectAuthor: vi.fn(),
  readProjectName: vi.fn(),
}));

import { input, select } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { readProjectAuthor, readProjectName } from '../../../src/lib/project.js';
import GenerateReact from '../../../src/commands/generate/react.js';

const ROOT = process.cwd();

// Default prompt order (no flags, no project author):
//   input(path) → select(hydrate) → input(author)?
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
  vi.mocked(select).mockResolvedValueOnce(hydrate as any);
  if (author !== undefined) vi.mocked(input).mockResolvedValueOnce(author);
}

describe('generate react', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(readProjectAuthor).mockResolvedValue(undefined);
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
      vi.mocked(select).mockResolvedValueOnce(false as any);
      vi.mocked(input).mockResolvedValueOnce('Flag Author');

      await GenerateReact.run(['app', '--path', '/fixed-path'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.path).toBe('/fixed-path');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // author only
    });

    it('--hydrate skips the hydrate select prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('/app').mockResolvedValueOnce('Author');

      await GenerateReact.run(['app', '--hydrate'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.hydrate).toBe(true);
      expect(vi.mocked(select)).not.toHaveBeenCalled();
    });

    it('--author skips all author resolution (package.json and input prompt)', async () => {
      vi.mocked(input).mockResolvedValueOnce('/app');
      vi.mocked(select).mockResolvedValueOnce(false as any);

      await GenerateReact.run(['app', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(readProjectAuthor).not.toHaveBeenCalled();
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // path only
    });

    it('--author takes precedence over package.json author', async () => {
      vi.mocked(readProjectAuthor).mockResolvedValue('Package Author');
      vi.mocked(input).mockResolvedValueOnce('/app');
      vi.mocked(select).mockResolvedValueOnce(false as any);

      await GenerateReact.run(['app', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
    });
  });

  describe('author resolution priority', () => {
    it('uses package.json author without prompting when no --author flag', async () => {
      vi.mocked(readProjectAuthor).mockResolvedValue('Package Author');
      stubPrompts(); // no author arg — author input prompt should not fire

      await GenerateReact.run(['app'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Package Author');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // path only
    });

    it('falls back to the author input prompt when package.json has no author', async () => {
      stubPrompts({ author: 'Prompted Author' });

      await GenerateReact.run(['app'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Prompted Author');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // path + author
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
});
