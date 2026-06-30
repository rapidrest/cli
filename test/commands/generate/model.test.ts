import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';

// Mocks must be declared before the imports they affect; vitest hoists vi.mock() calls.
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
import GenerateModel from '../../../src/commands/generate/model.js';

const ROOT = process.cwd();

// Stubs the two always-asked prompts (description, datastore).
// Pass author to also stub the author prompt (used when package.json has no author).
function stubPrompts(description = 'A test model', datastore = 'mongo', author?: string) {
  const mock = vi.mocked(input)
    .mockResolvedValueOnce(description)
    .mockResolvedValueOnce(datastore);
  if (author !== undefined) mock.mockResolvedValueOnce(author);
}

describe('generate model', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    // Default: no author in package.json → author prompt will fire
    vi.mocked(readProjectAuthor).mockResolvedValue(undefined);
  });

  it('builds the correct Handlebars context from prompts and passes it to processTemplate', async () => {
    stubPrompts('A product entity', 'mongo', 'Jane Doe');
    await GenerateModel.run(['Product', '--output-dir', '/tmp/test-models'], ROOT);

    expect(vi.mocked(processTemplate)).toHaveBeenCalledOnce();
    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect(context).toMatchObject({
      name: 'Product',
      description: 'A product entity',
      datastore: 'mongo',
      author: 'Jane Doe',
      year: new Date().getFullYear(),
    });
  });

  it('uses author from package.json without prompting for it', async () => {
    vi.mocked(readProjectAuthor).mockResolvedValue('Package Author');
    stubPrompts('A product entity', 'mongo'); // no author stub — prompt should not fire

    await GenerateModel.run(['Product', '--output-dir', '/tmp/test-models'], ROOT);

    const [, , context] = vi.mocked(processTemplate).mock.calls[0];
    expect(context.author).toBe('Package Author');
    expect(vi.mocked(input)).toHaveBeenCalledTimes(2); // only description + datastore
  });

  it('uses ./src/models as the default output directory', async () => {
    stubPrompts('desc', 'mongo', 'Author');
    await GenerateModel.run(['Widget'], ROOT);

    const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
    expect(outputDir).toBe(join(ROOT, 'src', 'models'));
  });

  it('uses the --output-dir value when provided', async () => {
    stubPrompts('desc', 'mongo', 'Author');
    await GenerateModel.run(['Widget', '--output-dir', '/custom/models'], ROOT);

    const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
    expect(outputDir).toBe('/custom/models');
  });

  it('passes force: true to processTemplate when --force is set', async () => {
    stubPrompts('desc', 'mongo', 'Author');
    await GenerateModel.run(['Widget', '--output-dir', '/tmp/m', '--force'], ROOT);

    const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
    expect(opts).toMatchObject({ force: true });
  });

  it('points processTemplate at the model template directory', async () => {
    stubPrompts('desc', 'mongo', 'Author');
    await GenerateModel.run(['Widget', '--output-dir', '/tmp/m'], ROOT);

    const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
    expect(templateDir).toContain(join('templates', 'model'));
  });
});
