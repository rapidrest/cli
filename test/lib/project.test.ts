///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: vi.fn() };
});

import { execFile } from 'child_process';
import {
  detectPackageManager,
  detectReact,
  extractDatastoreInfo,
  extractFirstModelProperty,
  extractModelDatastore,
  findExistingReactApps,
  formatDefaultPropertyValue,
  formatExamplePropertyValue,
  readGitAuthor,
  readModelDatastore,
  readModelProperty,
  readProjectAuthor,
  readProjectDatastores,
  readProjectModels,
  readProjectName,
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

  it('returns undefined when author is an object without a name field', async () => {
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ author: { email: 'jane@example.com' } }),
    );
    expect(await readProjectAuthor(tmpDir)).toBeUndefined();
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

describe('readProjectName', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrname-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns the name field from package.json', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
    expect(await readProjectName(tmpDir)).toBe('my-app');
  });

  it('returns an empty string when the name field is absent', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    expect(await readProjectName(tmpDir)).toBe('');
  });

  it('returns an empty string when package.json does not exist', async () => {
    expect(await readProjectName(join(tmpDir, 'nonexistent'))).toBe('');
  });

  it('returns an empty string when package.json is invalid JSON', async () => {
    await writeFile(join(tmpDir, 'package.json'), 'not json');
    expect(await readProjectName(tmpDir)).toBe('');
  });
});

describe('detectPackageManager', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrpm-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns "yarn" when package.json packageManager field starts with "yarn"', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.5.3' }));
    expect(await detectPackageManager(tmpDir)).toBe('yarn');
  });

  it('returns "yarn" when yarn.lock exists and there is no packageManager field', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
    await writeFile(join(tmpDir, 'yarn.lock'), '');
    expect(await detectPackageManager(tmpDir)).toBe('yarn');
  });

  it('returns "npm" when there is no package.json, yarn.lock, or packageManager field', async () => {
    expect(await detectPackageManager(tmpDir)).toBe('npm');
  });

  it('returns "npm" when package.json is invalid JSON and no yarn.lock exists', async () => {
    await writeFile(join(tmpDir, 'package.json'), 'not json');
    expect(await detectPackageManager(tmpDir)).toBe('npm');
  });

  it('returns "npm" when packageManager field does not start with "yarn"', async () => {
    await writeFile(join(tmpDir, 'package.json'), JSON.stringify({ packageManager: 'npm@10.0.0' }));
    expect(await detectPackageManager(tmpDir)).toBe('npm');
  });
});

describe('readGitAuthor', () => {
  function mockExecFile(responses: Record<string, { stdout: string } | Error>): void {
    vi.mocked(execFile).mockImplementation(((file: string, args: readonly string[], callback: any) => {
      const key = args.join(' ');
      const resp = responses[key];
      if (resp instanceof Error) callback(resp);
      else callback(null, { stdout: resp?.stdout ?? '', stderr: '' });
      return {} as any;
    }) as any);
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns "Name <email>" when both user.name and user.email are configured', async () => {
    mockExecFile({
      'config user.name': { stdout: 'Jane Doe\n' },
      'config user.email': { stdout: 'jane@example.com\n' },
    });
    expect(await readGitAuthor()).toBe('Jane Doe <jane@example.com>');
  });

  it('returns just the name when the email lookup fails', async () => {
    mockExecFile({
      'config user.name': { stdout: 'Jane Doe\n' },
      'config user.email': new Error('no email configured'),
    });
    expect(await readGitAuthor()).toBe('Jane Doe');
  });

  it('returns just the name when user.email resolves to an empty string', async () => {
    mockExecFile({
      'config user.name': { stdout: 'Jane Doe\n' },
      'config user.email': { stdout: '\n' },
    });
    expect(await readGitAuthor()).toBe('Jane Doe');
  });

  it('returns undefined when the user.name lookup fails (git unavailable)', async () => {
    mockExecFile({
      'config user.name': new Error('git not found'),
    });
    expect(await readGitAuthor()).toBeUndefined();
  });

  it('returns undefined when user.name resolves to an empty string', async () => {
    mockExecFile({
      'config user.name': { stdout: '   \n' },
    });
    expect(await readGitAuthor()).toBeUndefined();
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

  it('handles escaped quotes inside string literals without ending the string early', () => {
    const src = `datastores: { acl: { url: 'it\\'s here', type: 'mongodb' } }`;
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

describe('findExistingReactApps', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrapps-'));
    await mkdir(join(tmpDir, 'src', 'routes'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty array when src/routes does not exist', async () => {
    await rm(join(tmpDir, 'src', 'routes'), { recursive: true, force: true });
    expect(await findExistingReactApps(tmpDir)).toEqual([]);
  });

  it('returns an empty array when src/routes has no ReactRoute subclasses', async () => {
    await writeFile(join(tmpDir, 'src', 'routes', 'UserRoute.ts'), `export class UserRoute extends ModelRoute {}`);
    expect(await findExistingReactApps(tmpDir)).toEqual([]);
  });

  it('extracts className, appDir, and the @Route mount path from a ReactRoute subclass', async () => {
    await writeFile(
      join(tmpDir, 'src', 'routes', 'AppRoute.ts'),
      `import { ReactRoute } from "@rapidrest/react";\n` +
        `@Route("/")\n` +
        `export class AppRoute extends ReactRoute {\n` +
        `    protected readonly appDir: string = "app";\n` +
        `}\n`,
    );
    expect(await findExistingReactApps(tmpDir)).toEqual([
      { routeFile: 'src/routes/AppRoute.ts', className: 'AppRoute', appDir: 'app', routePath: '/' },
    ]);
  });

  it('defaults routePath to "" when no @Route decorator is present', async () => {
    await writeFile(
      join(tmpDir, 'src', 'routes', 'AppRoute.ts'),
      `export class AppRoute extends ReactRoute {\n    protected readonly appDir: string = "app";\n}\n`,
    );
    const [app] = await findExistingReactApps(tmpDir);
    expect(app.routePath).toBe('');
  });

  it('skips a ReactRoute subclass with no appDir field (nothing to migrate/report)', async () => {
    await writeFile(join(tmpDir, 'src', 'routes', 'AppRoute.ts'), `export class AppRoute extends ReactRoute {}`);
    expect(await findExistingReactApps(tmpDir)).toEqual([]);
  });

  it('finds every app across multiple route files', async () => {
    await writeFile(
      join(tmpDir, 'src', 'routes', 'WwwRoute.ts'),
      `@Route("/")\nexport class WwwRoute extends ReactRoute {\n    protected readonly appDir: string = "apps/www";\n}\n`,
    );
    await writeFile(
      join(tmpDir, 'src', 'routes', 'AdminRoute.ts'),
      `@Route("/admin")\nexport class AdminRoute extends ReactRoute {\n    protected readonly appDir: string = "apps/admin";\n}\n`,
    );
    const apps = await findExistingReactApps(tmpDir);
    expect(apps.map((a) => a.appDir).sort()).toEqual(['apps/admin', 'apps/www']);
  });

  it('ignores non-.ts files and .d.ts files in src/routes', async () => {
    await writeFile(join(tmpDir, 'src', 'routes', 'readme.txt'), 'not a route');
    await writeFile(
      join(tmpDir, 'src', 'routes', 'AppRoute.d.ts'),
      `export class AppRoute extends ReactRoute {\n    protected readonly appDir: string = "app";\n}\n`,
    );
    expect(await findExistingReactApps(tmpDir)).toEqual([]);
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

describe('extractFirstModelProperty', () => {
  it('finds the first public field declared on the model', () => {
    const source = `
class Product {
    @Identifier
    @Column()
    public name: string = "";

    @Column()
    public price: number = 0;
}`;
    expect(extractFirstModelProperty(source)).toEqual({ name: 'name', type: 'string' });
  });

  it('skips constructor body assignments like `this.name = ...`', () => {
    const source = `
class Product {
    public name: string = "";

    constructor(other?: any) {
        this.name = "name" in other ? other.name.trim() : this.name;
    }
}`;
    expect(extractFirstModelProperty(source)).toEqual({ name: 'name', type: 'string' });
  });

  it('handles optional properties with no default value', () => {
    const source = `class Product {\n    public sku?: string;\n}`;
    expect(extractFirstModelProperty(source)).toEqual({ name: 'sku', type: 'string' });
  });

  it('handles union types', () => {
    const source = `class Product {\n    public phone: string | undefined = undefined;\n}`;
    expect(extractFirstModelProperty(source)).toEqual({ name: 'phone', type: 'string | undefined' });
  });

  it('returns undefined when no public field is declared', () => {
    expect(extractFirstModelProperty(`class Product {}`)).toBeUndefined();
  });
});

describe('readModelProperty', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrmp-'));
    await mkdir(join(tmpDir, 'src', 'models'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('reads the first declared property from the named model file', async () => {
    await writeFile(
      join(tmpDir, 'src', 'models', 'Product.ts'),
      `export default class Product {\n    public sku: string = "";\n}`,
    );
    expect(await readModelProperty(tmpDir, 'Product')).toEqual({ name: 'sku', type: 'string' });
  });

  it('returns undefined when the model file does not exist', async () => {
    expect(await readModelProperty(tmpDir, 'Missing')).toBeUndefined();
  });
});

describe('formatExamplePropertyValue', () => {
  it('returns a string literal for string types', () => {
    expect(formatExamplePropertyValue('string')).toBe('"updated"');
    expect(formatExamplePropertyValue('string | undefined')).toBe('"updated"');
  });

  it('returns a numeric literal for number types', () => {
    expect(formatExamplePropertyValue('number')).toBe('42');
  });

  it('returns a boolean literal for boolean types', () => {
    expect(formatExamplePropertyValue('boolean')).toBe('true');
  });

  it('falls back to an `as any` string cast for unrecognized types', () => {
    expect(formatExamplePropertyValue('ProductStatus')).toBe('"updated" as any');
    expect(formatExamplePropertyValue('string[]')).toBe('"updated" as any');
  });
});

describe('formatDefaultPropertyValue', () => {
  it('returns an empty string literal for string', () => {
    expect(formatDefaultPropertyValue('string')).toBe('""');
  });

  it('returns 0 for number', () => {
    expect(formatDefaultPropertyValue('number')).toBe('0');
  });

  it('returns false for boolean', () => {
    expect(formatDefaultPropertyValue('boolean')).toBe('false');
  });

  it('returns an empty array literal for string[] and number[]', () => {
    expect(formatDefaultPropertyValue('string[]')).toBe('[]');
    expect(formatDefaultPropertyValue('number[]')).toBe('[]');
  });

  it('returns `new Date()` for Date', () => {
    expect(formatDefaultPropertyValue('Date')).toBe('new Date()');
  });

  it('returns an `undefined as any` cast for an unrecognized/custom type', () => {
    expect(formatDefaultPropertyValue('Record<string, unknown>')).toBe('undefined as any');
    expect(formatDefaultPropertyValue('ProductStatus')).toBe('undefined as any');
  });
});
