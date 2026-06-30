import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import {
  detectReact,
  extractDatastoreInfo,
  extractModelDatastore,
  readModelDatastore,
  readProjectAuthor,
  readProjectDatastores,
  readProjectModels,
} from '../../src/lib/project.js';

describe('detectReact', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrreact-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns true when vite.config.ts exists', async () => {
    await writeFile(join(tmpDir, 'vite.config.ts'), '');
    expect(await detectReact(tmpDir)).toBe(true);
  });

  it('returns false when vite.config.ts does not exist', async () => {
    expect(await detectReact(tmpDir)).toBe(false);
  });

  it('returns false for a non-existent directory', async () => {
    expect(await detectReact(join(tmpDir, 'nonexistent'))).toBe(false);
  });
});

describe('readProjectAuthor', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrproj-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns a string author field', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ author: 'Jane Doe' }));
    expect(await readProjectAuthor(tmpDir)).toBe('Jane Doe');
  });

  it('returns the name from an object author field', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ author: { name: 'Jane Doe', email: 'jane@example.com' } }),
    );
    expect(await readProjectAuthor(tmpDir)).toBe('Jane Doe');
  });

  it('returns undefined when author is an empty string', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ author: '' }));
    expect(await readProjectAuthor(tmpDir)).toBeUndefined();
  });

  it('returns undefined when author field is absent', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
    expect(await readProjectAuthor(tmpDir)).toBeUndefined();
  });

  it('returns undefined when package.json does not exist', async () => {
    expect(await readProjectAuthor(join(tmpDir, 'nonexistent'))).toBeUndefined();
  });

  it('returns undefined when package.json is invalid JSON', async () => {
    await writeFile(join(tmpDir, 'package.json'), 'not json');
    expect(await readProjectAuthor(tmpDir)).toBeUndefined();
  });
});

describe('extractDatastoreInfo', () => {
  it('extracts name and type for each top-level datastore property', () => {
    const src = `
      datastores: {
        acl: { type: 'mongodb', host: 'localhost' },
        users: { type: 'postgres', host: 'localhost' },
      }
    `;
    expect(extractDatastoreInfo(src)).toEqual([
      { name: 'acl', type: 'mongodb' },
      { name: 'users', type: 'postgres' },
    ]);
  });

  it('handles multi-line datastore objects', () => {
    const src = `
      datastores: {
        mongo: {
          type: 'mongodb',
          host: 'localhost',
          database: 'myapp',
        },
      }
    `;
    expect(extractDatastoreInfo(src)).toEqual([{ name: 'mongo', type: 'mongodb' }]);
  });

  it('returns an empty array when there is no datastores block', () => {
    expect(extractDatastoreInfo('export const config = { port: 3000 }')).toEqual([]);
  });

  it('returns empty type when the datastore object has no type field', () => {
    const src = `datastores: { cache: { host: 'localhost' } }`;
    expect(extractDatastoreInfo(src)).toEqual([{ name: 'cache', type: '' }]);
  });

  it('does not confuse nested type fields with the top-level one', () => {
    const src = `
      datastores: {
        acl: {
          options: { type: 'replica' },
          type: 'mongodb',
        },
      }
    `;
    expect(extractDatastoreInfo(src)).toEqual([{ name: 'acl', type: 'mongodb' }]);
  });

  it('ignores type values inside string literals', () => {
    const src = `
      datastores: {
        acl: {
          url: 'type: not-a-type',
          type: 'mongodb',
        },
      }
    `;
    expect(extractDatastoreInfo(src)).toEqual([{ name: 'acl', type: 'mongodb' }]);
  });

  it('skips // line comments', () => {
    const src = `
      datastores: {
        // acl: { type: 'hidden' },
        mongo: { type: 'mongodb' },
      }
    `;
    expect(extractDatastoreInfo(src)).toEqual([{ name: 'mongo', type: 'mongodb' }]);
  });
});

describe('readProjectDatastores', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrds-'));
    await mkdir(join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads datastores from src/config.ts', async () => {
    await writeFile(
      join(tmpDir, 'src', 'config.ts'),
      `export default { datastores: { acl: { type: 'mongodb' } } }`,
    );
    expect(await readProjectDatastores(tmpDir)).toEqual([{ name: 'acl', type: 'mongodb' }]);
  });

  it('returns an empty array when src/config.ts does not exist', async () => {
    expect(await readProjectDatastores(tmpDir)).toEqual([]);
  });
});

describe('extractModelDatastore', () => {
  it('extracts the datastore name from a @DataStore decorator', () => {
    expect(extractModelDatastore(`@DataStore('acl')\nclass Foo {}`)).toBe('acl');
  });

  it('handles double-quoted strings', () => {
    expect(extractModelDatastore(`@DataStore("users")\nclass Foo {}`)).toBe('users');
  });

  it('returns an empty string when no @DataStore decorator is present', () => {
    expect(extractModelDatastore(`@Entity()\nclass Foo {}`)).toBe('');
  });
});

describe('readProjectModels', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrmodels-'));
    await mkdir(join(tmpDir, 'src', 'models'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns the class name (filename without .ts) for each model file', async () => {
    await writeFile(join(tmpDir, 'src', 'models', 'Product.ts'), '');
    await writeFile(join(tmpDir, 'src', 'models', 'User.ts'), '');
    const result = await readProjectModels(tmpDir);
    expect(result.sort()).toEqual(['Product', 'User']);
  });

  it('excludes .d.ts declaration files', async () => {
    await writeFile(join(tmpDir, 'src', 'models', 'Product.ts'), '');
    await writeFile(join(tmpDir, 'src', 'models', 'Product.d.ts'), '');
    expect(await readProjectModels(tmpDir)).toEqual(['Product']);
  });

  it('returns an empty array when src/models does not exist', async () => {
    await rm(join(tmpDir, 'src', 'models'), { recursive: true });
    expect(await readProjectModels(tmpDir)).toEqual([]);
  });
});

describe('readModelDatastore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrmds-'));
    await mkdir(join(tmpDir, 'src', 'models'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads the @DataStore value from the named model file', async () => {
    await writeFile(
      join(tmpDir, 'src', 'models', 'Product.ts'),
      `@DataStore('acl')\nexport default class Product {}`,
    );
    expect(await readModelDatastore(tmpDir, 'Product')).toBe('acl');
  });

  it('returns an empty string when the model file does not exist', async () => {
    expect(await readModelDatastore(tmpDir, 'Missing')).toBe('');
  });

  it('returns an empty string when the model has no @DataStore decorator', async () => {
    await writeFile(join(tmpDir, 'src', 'models', 'Simple.ts'), 'export default class Simple {}');
    expect(await readModelDatastore(tmpDir, 'Simple')).toBe('');
  });
});
