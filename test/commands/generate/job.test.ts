import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}));

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  readProjectName: vi.fn(),
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

import { input } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { readProjectName } from '../../../src/lib/project.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import GenerateJob from '../../../src/commands/generate/job.js';

const ROOT = process.cwd();

// Default prompt order: input(description) → inputAuthor(cwd) → input(schedule)
function stubPrompts({
  description = 'Collects metrics',
  schedule = '* * * * *',
  author,
}: {
  description?: string;
  schedule?: string;
  author?: string;
} = {}) {
  vi.mocked(input).mockResolvedValueOnce(description).mockResolvedValueOnce(schedule);
  if (author !== undefined) vi.mocked(inputAuthor).mockResolvedValueOnce(author);
}

describe('generate job', () => {
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
      stubPrompts({ description: 'Collects metrics', schedule: '*/5 * * * *', author: 'Alice' });

      await GenerateJob.run(['MetricsCollector', '--output-dir', '/tmp/jobs'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        name: 'MetricsCollector',
        description: 'Collects metrics',
        schedule: '*/5 * * * *',
        author: 'Alice',
        project_name: 'my-app',
        year: new Date().getFullYear(),
      });
    });

    it('includes project_name from the project config in the context', async () => {
      vi.mocked(readProjectName).mockResolvedValue('another-app');
      stubPrompts({ author: 'Author' });

      await GenerateJob.run(['Notificatier', '--output-dir', '/tmp/jobs'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.project_name).toBe('another-app');
      expect(readProjectName).toHaveBeenCalledWith(process.cwd());
    });
  });

  describe('flag shortcuts bypass prompts', () => {
    it('--description skips the description input prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('* * * * *'); // schedule only
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');

      await GenerateJob.run(['Job', '--output-dir', '/tmp/jobs', '--description', 'From flag'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.description).toBe('From flag');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // schedule only
    });

    it('--schedule skips the schedule input prompt', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc'); // description only
      vi.mocked(inputAuthor).mockResolvedValueOnce('Author');

      await GenerateJob.run(['Job', '--output-dir', '/tmp/jobs', '--schedule', '0 0 * * *'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.schedule).toBe('0 0 * * *');
      expect(vi.mocked(input)).toHaveBeenCalledTimes(1); // description only
    });

    it('--author skips inputAuthor entirely', async () => {
      vi.mocked(input).mockResolvedValueOnce('A desc').mockResolvedValueOnce('* * * * *');

      await GenerateJob.run(['Job', '--output-dir', '/tmp/jobs', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
      expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // description + schedule
    });

    it('skips all prompts when description, schedule, and author flags are all provided', async () => {
      await GenerateJob.run(
        ['Job', '--output-dir', '/tmp/jobs', '--description', 'D', '--schedule', 'S', '--author', 'A'],
        ROOT,
      );

      expect(vi.mocked(input)).not.toHaveBeenCalled();
      expect(inputAuthor).not.toHaveBeenCalled();
    });
  });

  describe('author resolution', () => {
    it('calls inputAuthor with the project cwd and uses its return value', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author <git@example.com>');
      stubPrompts();

      await GenerateJob.run(['Job', '--output-dir', '/tmp/jobs'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author <git@example.com>');
      expect(inputAuthor).toHaveBeenCalledWith(process.cwd());
    });
  });

  describe('output and template options', () => {
    it('uses process.cwd() as the default output directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateJob.run(['Job'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(ROOT);
    });

    it('uses --output-dir when provided', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateJob.run(['Job', '--output-dir', '/custom/jobs'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe('/custom/jobs');
    });

    it('passes force: true to processTemplate when --force is set', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateJob.run(['Job', '--output-dir', '/tmp/jobs', '--force'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: true });
    });

    it('passes projectDir: cwd to processTemplate', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateJob.run(['Job', '--output-dir', '/tmp/jobs'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ projectDir: process.cwd() });
    });

    it('points processTemplate at the job template directory', async () => {
      stubPrompts({ author: 'Author' });
      await GenerateJob.run(['Job', '--output-dir', '/tmp/jobs'], ROOT);

      const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(templateDir).toContain(join('templates', 'job'));
    });
  });
});
