import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
}));

vi.mock('../../src/lib/project.js', () => ({
  readGitAuthor: vi.fn(),
  readProjectAuthor: vi.fn(),
}));

import { input } from '@inquirer/prompts';
import { readGitAuthor, readProjectAuthor } from '../../src/lib/project.js';
import { inputAuthor } from '../../src/lib/prompts.js';

describe('inputAuthor', () => {
  beforeEach(() => {
    vi.mocked(readGitAuthor).mockResolvedValue(undefined);
    vi.mocked(readProjectAuthor).mockResolvedValue(undefined);
    vi.mocked(input).mockResolvedValue('Entered Author');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('always calls input() and returns whatever the user enters', async () => {
    vi.mocked(input).mockResolvedValue('Typed Author');

    const result = await inputAuthor();

    expect(result).toBe('Typed Author');
    expect(input).toHaveBeenCalledOnce();
  });

  it('uses git config author as the default value for the prompt', async () => {
    vi.mocked(readGitAuthor).mockResolvedValue('Git Author <git@example.com>');

    await inputAuthor();

    const call = vi.mocked(input).mock.calls[0][0] as any;
    expect(call.default).toBe('Git Author <git@example.com>');
  });

  it('uses package.json author as the default when git config is not set and cwd is provided', async () => {
    vi.mocked(readProjectAuthor).mockResolvedValue('Package Author');

    await inputAuthor('/some/project');

    const call = vi.mocked(input).mock.calls[0][0] as any;
    expect(call.default).toBe('Package Author');
    expect(readProjectAuthor).toHaveBeenCalledWith('/some/project');
  });

  it('prefers git config over package.json when both are available', async () => {
    vi.mocked(readGitAuthor).mockResolvedValue('Git Author <git@example.com>');
    vi.mocked(readProjectAuthor).mockResolvedValue('Package Author');

    await inputAuthor('/some/project');

    const call = vi.mocked(input).mock.calls[0][0] as any;
    expect(call.default).toBe('Git Author <git@example.com>');
    expect(readProjectAuthor).not.toHaveBeenCalled();
  });

  it('uses undefined as the default when neither git config nor package.json has an author', async () => {
    await inputAuthor('/some/project');

    const call = vi.mocked(input).mock.calls[0][0] as any;
    expect(call.default).toBeUndefined();
  });

  it('does not call readProjectAuthor when no cwd is provided', async () => {
    await inputAuthor();

    expect(readProjectAuthor).not.toHaveBeenCalled();
  });

  it('does not call readProjectAuthor when git config returns an author', async () => {
    vi.mocked(readGitAuthor).mockResolvedValue('Git Author');

    await inputAuthor('/some/project');

    expect(readProjectAuthor).not.toHaveBeenCalled();
  });

  it('passes the correct message and required flag to input()', async () => {
    await inputAuthor();

    const call = vi.mocked(input).mock.calls[0][0] as any;
    expect(call.message).toBe('Enter the author name:');
    expect(call.required).toBe(true);
  });
});
