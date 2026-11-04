///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/lib/template.js', () => ({ processTemplate: vi.fn() }));

import { processTemplate } from '../../src/lib/template.js';
import { resolveTemplates } from '../../src/lib/templateSource.js';
import { renderTemplate, useTemplates } from '../../src/lib/templateCommand.js';

function fakeCommand() {
  return {
    config: { root: '/cli' },
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn((message: string) => { throw new Error(`error: ${message}`); }),
  } as never as Parameters<typeof useTemplates>[0] & { log: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
}

describe('useTemplates', () => {
  afterEach(() => {
    delete process.env.RAPIDREST_TEMPLATES;
  });

  it('resolves templates for the command, routing its log and warnings', async () => {
    const cmd = fakeCommand();
    await useTemplates(cmd, '/project', 'project', '1.2.0');
    const call = vi.mocked(resolveTemplates).mock.calls.at(-1)![0];
    expect(call).toMatchObject({ cliRoot: '/cli', cwd: '/project', mode: 'project', override: '1.2.0' });
    call.log!('hello');
    call.warn!('careful');
    expect(cmd.log).toHaveBeenCalledWith('hello');
    expect(cmd.warn).toHaveBeenCalledWith('careful');
  });

  it('takes the override from RAPIDREST_TEMPLATES when no flag is given', async () => {
    process.env.RAPIDREST_TEMPLATES = '/my/templates';
    await useTemplates(fakeCommand(), '/project', 'new', undefined);
    expect(vi.mocked(resolveTemplates).mock.calls.at(-1)![0].override).toBe('/my/templates');
    process.env.RAPIDREST_TEMPLATES = '';
    await useTemplates(fakeCommand(), '/project', 'new', undefined);
    expect(vi.mocked(resolveTemplates).mock.calls.at(-1)![0].override).toBeUndefined();
  });

  it('reports a resolution failure as the command\'s error', async () => {
    vi.mocked(resolveTemplates).mockRejectedValueOnce(new Error('offline'));
    await expect(useTemplates(fakeCommand(), '/p', 'new', undefined)).rejects.toThrow('error: offline');
    vi.mocked(resolveTemplates).mockRejectedValueOnce('odd');
    await expect(useTemplates(fakeCommand(), '/p', 'new', undefined)).rejects.toThrow('error: odd');
  });
});

describe('renderTemplate', () => {
  it('renders with a version resolver, and closes it even on failure', async () => {
    const cmd = fakeCommand();
    await renderTemplate(cmd, '/t/route', '/out', { a: 1 }, { force: true, projectDir: '/p' });
    expect(processTemplate).toHaveBeenCalledWith('/t/route', '/out', { a: 1 },
      { force: true, projectDir: '/p', resolveVersion: expect.any(Function) });

    // The resolver writes non-resolvable ranges as is, without a network lookup.
    const resolve = vi.mocked(processTemplate).mock.calls[0][3]!.resolveVersion!;
    expect(await resolve('x', '1.0.0')).toBe('1.0.0');

    vi.mocked(processTemplate).mockRejectedValueOnce(new Error('boom'));
    await expect(renderTemplate(cmd, '/t', '/o', {}, {})).rejects.toThrow('boom');
  });
});
