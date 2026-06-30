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

vi.mock('../../../src/lib/project.js', () => ({
  readProjectAuthor: vi.fn(),
}));

import { input } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { readProjectAuthor } from '../../../src/lib/project.js';
import GenerateRoute from '../../../src/commands/generate/route.js';

const ROOT = process.cwd();

// Stubs the two always-asked prompts (description, routePath).
// Pass author to also stub the author prompt (used when package.json has no author).
function stubPrompts(description = 'Handles products', path = '/api/v1/products', author?: string) {
  const mock = vi.mocked(input)
    .mockResolvedValueOnce(description)
    .mockResolvedValueOnce(path);
  if (author !== undefined) mock.mockResolvedValueOnce(author);
}

describe('generate route', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    // Default: no author in package.json → author prompt will fire
    vi.mocked(readProjectAuthor).mockResolvedValue(undefined);
  });

  it('builds the correct context from prompts', async () => {
    stubPrompts('Manages orders', '/api/v1/orders', 'Alice');
    await GenerateRoute.run(['OrderRoute', '--output-dir', '/tmp/routes', '--no-test'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect(context).toMatchObject({
      name: 'OrderRoute',
      description: 'Manages orders',
      path: '/api/v1/orders',
      author: 'Alice',
      year: new Date().getFullYear(),
    });
  });

  it('uses author from package.json without prompting for it', async () => {
    vi.mocked(readProjectAuthor).mockResolvedValue('Package Author');
    stubPrompts('Manages orders', '/api/v1/orders'); // no author stub — prompt should not fire

    await GenerateRoute.run(['OrderRoute', '--output-dir', '/tmp/routes', '--no-test'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect(context.author).toBe('Package Author');
    expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // only description + path
  });

  it('calls processTemplate twice by default (route file + test file)', async () => {
    stubPrompts('desc', '/api/v1/x', 'Author');
    await GenerateRoute.run(['ProductRoute', '--output-dir', '/tmp/routes'], ROOT);

    expect(vi.mocked(processTemplate)).toHaveBeenCalledTimes(2);
    const templateDirs = vi.mocked(processTemplate).mock.calls.map(([td]) => td);
    expect(templateDirs.some((d) => d.includes(join('route', 'src', 'routes')))).toBe(true);
    expect(templateDirs.some((d) => d.includes(join('route', 'test')))).toBe(true);
  });

  it('skips the test file when --no-test is passed', async () => {
    stubPrompts('desc', '/api/v1/x', 'Author');
    await GenerateRoute.run(['ProductRoute', '--output-dir', '/tmp/routes', '--no-test'], ROOT);

    expect(vi.mocked(processTemplate)).toHaveBeenCalledOnce();
    const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
    expect(templateDir).toContain(join('route', 'src', 'routes'));
  });

  it('uses ./src/routes as the default output directory for the route file', async () => {
    stubPrompts('desc', '/api/v1/x', 'Author');
    await GenerateRoute.run(['ProductRoute', '--no-test'], ROOT);

    const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
    expect(outputDir).toBe(join(ROOT, 'src', 'routes'));
  });

  it('passes force: true to both processTemplate calls when --force is set', async () => {
    stubPrompts('desc', '/api/v1/x', 'Author');
    await GenerateRoute.run(['ProductRoute', '--output-dir', '/tmp/routes', '--force'], ROOT);

    for (const call of vi.mocked(processTemplate).mock.calls) {
      expect(call[3]).toMatchObject({ force: true });
    }
  });
});
