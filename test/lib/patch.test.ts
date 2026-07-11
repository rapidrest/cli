import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import os from 'os';
import { tsBlockInsert, tsPropertySet, jsonMerge, applyPatches, type PatchEntry } from '../../src/lib/patch.js';

// ---------------------------------------------------------------------------
// tsBlockInsert
// ---------------------------------------------------------------------------

describe('tsBlockInsert', () => {
  const baseSource = `export default {
  port: 3000,
  datastores: {
    mongo: {
      type: "mongodb",
      host: "localhost",
    },
  },
};`;

  it('inserts a snippet before the closing brace of the named block', () => {
    const snippet = '    postgres: {\n      type: "postgresql",\n    },\n';
    const result = tsBlockInsert(baseSource, 'datastores', snippet, '');
    expect(result).toContain('postgres:');
    expect(result).toContain('type: "postgresql"');
    expect(result).toContain('mongo:'); // existing entry preserved
    // snippet appears before the closing of the outer object
    expect(result.indexOf('postgres:')).toBeLessThan(result.indexOf('};'));
  });

  it('is a no-op when idempotencyKey already appears as a depth-1 property', () => {
    const snippet = '    mongo: {\n      type: "mongodb",\n    },\n';
    const result = tsBlockInsert(baseSource, 'datastores', snippet, 'mongo');
    expect(result).toBe(baseSource);
  });

  it('inserts when idempotencyKey does not match any existing property', () => {
    const snippet = '    redis: {\n      type: "redis",\n    },\n';
    const result = tsBlockInsert(baseSource, 'datastores', snippet, 'redis');
    expect(result).toContain('redis:');
    expect(result).toContain('mongo:'); // existing preserved
  });

  it('throws a descriptive error when the named block does not exist', () => {
    expect(() =>
      tsBlockInsert('export default { port: 3000 };', 'datastores', 'foo', ''),
    ).toThrow("Could not find 'datastores' block");
  });

  it('handles an empty block', () => {
    const src = 'const c = { datastores: { } };';
    const snippet = '    acl: { type: "mongodb" },\n';
    const result = tsBlockInsert(src, 'datastores', snippet, '');
    expect(result).toContain('acl: { type: "mongodb" }');
  });

  it('does not match property names inside string literals', () => {
    const src = `export default {
  datastores: {
    // description: "this has a mongo: keyword in a comment",
    items: { url: 'mongo: is just a string' },
    mongo: { type: "mongodb" },
  },
};`;
    const result = tsBlockInsert(src, 'datastores', '    redis: {},\n', 'redis');
    expect(result).toContain('redis:');
    expect(result).toContain('mongo:'); // original preserved
  });

  it('skips property names inside // comments when checking idempotency', () => {
    const src = `export default {
  datastores: {
    // postgres: { type: "postgresql" },
    mongo: { type: "mongodb" },
  },
};`;
    // 'postgres' only appears in a comment — should NOT be treated as an existing property
    const snippet = '    postgres: { type: "postgresql" },\n';
    const result = tsBlockInsert(src, 'datastores', snippet, 'postgres');
    expect(result).toContain('    postgres: { type: "postgresql" }');
  });

  describe('root config object (empty blockName)', () => {
    const confSource = `const conf = nconf.argv();
conf.defaults({
  auth: {
    strategy: "auth.JWTStrategy",
  },
  datastores: {
    mongo: {
      type: "mongodb",
    },
  },
});`;

    it('inserts the snippet as a top-level sibling, not inside the first named block', () => {
      const snippet = '  static_files: "public",\n';
      const result = tsBlockInsert(confSource, '', snippet, 'static_files');
      expect(result).toContain('static_files:');
      // Must land after the root object's own content, not nested inside `auth`
      const authBlock = result.slice(result.indexOf('auth: {'), result.indexOf('datastores: {'));
      expect(authBlock).not.toContain('static_files');
      expect(result.indexOf('static_files:')).toBeGreaterThan(result.indexOf('datastores: {'));
    });

    it('inserts immediately before the closing of the .defaults({ ... }) call', () => {
      const snippet = '  static_files: "public",\n';
      const result = tsBlockInsert(confSource, '', snippet, 'static_files');
      expect(result).toContain('static_files: "public",\n});');
    });

    it('is a no-op when idempotencyKey already appears as a top-level property', () => {
      const src = `conf.defaults({
  auth: { strategy: "jwt" },
  static_files: "public",
});`;
      const result = tsBlockInsert(src, '', '  static_files: "assets",\n', 'static_files');
      expect(result).toBe(src);
    });

    it('does not match a property of the same name nested inside a named block', () => {
      // A `static_files` key nested inside `auth` should NOT satisfy the top-level idempotency check
      const src = `conf.defaults({
  auth: {
    static_files: "nested-not-the-target",
  },
});`;
      const snippet = '  static_files: "public",\n';
      const result = tsBlockInsert(src, '', snippet, 'static_files');
      // Should insert a second, top-level static_files rather than treating the nested one as already patched
      const matches = result.match(/static_files:/g) ?? [];
      expect(matches.length).toBe(2);
      expect(result).toContain('static_files: "public",\n});');
    });

    it('throws a descriptive error when no .defaults({ ... }) call exists', () => {
      expect(() =>
        tsBlockInsert('export default { port: 3000 };', '', 'foo', ''),
      ).toThrow("Could not find the root config object");
    });
  });
});

// ---------------------------------------------------------------------------
// tsPropertySet
// ---------------------------------------------------------------------------

describe('tsPropertySet', () => {
  const baseSource = `conf.defaults({
  rbac: {
    enabled: false,
  },
  logger: {
    level: "info",
  },
});`;

  it('replaces the value of the named property inside the block', () => {
    const result = tsPropertySet(baseSource, 'rbac', 'enabled', 'true');
    expect(result).toContain('enabled: true');
    expect(result).not.toContain('enabled: false');
  });

  it('is a no-op when the value is already the desired value', () => {
    const src = `conf.defaults({ rbac: { enabled: true, }, });`;
    const result = tsPropertySet(src, 'rbac', 'enabled', 'true');
    expect(result).toBe(src);
  });

  it('preserves all other content outside the changed property', () => {
    const result = tsPropertySet(baseSource, 'rbac', 'enabled', 'true');
    expect(result).toContain('logger:');
    expect(result).toContain('level: "info"');
  });

  it('throws when the named block does not exist', () => {
    expect(() =>
      tsPropertySet('conf.defaults({ port: 3000 });', 'rbac', 'enabled', 'true'),
    ).toThrow("Could not find 'rbac' block");
  });

  it('returns source unchanged when the property does not exist in the block', () => {
    const src = `conf.defaults({ rbac: { someOther: false } });`;
    const result = tsPropertySet(src, 'rbac', 'enabled', 'true');
    expect(result).toBe(src);
  });

  it('does not affect same-named properties inside sibling blocks', () => {
    const src = `conf.defaults({
  rbac: {
    enabled: false,
  },
  metrics: {
    enabled: true,
  },
});`;
    const result = tsPropertySet(src, 'rbac', 'enabled', 'true');
    // rbac.enabled set to true
    expect(result).toMatch(/rbac:\s*\{[^}]*enabled:\s*true/s);
    // metrics.enabled stays true (was already true, no change needed there)
    expect(result).toContain('metrics:');
  });

  it('handles an object-valued property without corrupting it', () => {
    const src = `conf.defaults({ session: { options: { secure: false } } });`;
    // Setting options to a new object value
    const result = tsPropertySet(src, 'session', 'options', '{ secure: true }');
    expect(result).toContain('options: { secure: true }');
  });

  it('skips // comments when scanning for property names', () => {
    const src = `conf.defaults({
  rbac: {
    // enabled: true,
    enabled: false,
  },
});`;
    const result = tsPropertySet(src, 'rbac', 'enabled', 'true');
    expect(result).toContain('// enabled: true,');  // comment unchanged
    expect(result).not.toContain('\n    enabled: false,'); // real property replaced
  });
});

// ---------------------------------------------------------------------------
// jsonMerge
// ---------------------------------------------------------------------------

describe('jsonMerge', () => {
  it('merges dependencies into an existing package.json object', () => {
    const target = {
      dependencies: { lodash: '^4.0.0' },
      devDependencies: { vitest: '^3.0.0' },
    };
    const patch = {
      dependencies: { mongodb: '^7.3.0' },
      devDependencies: { 'mongodb-memory-server': '^11.2.0' },
    };
    const result = jsonMerge(target, patch);
    expect(result).toEqual({
      dependencies: { lodash: '^4.0.0', mongodb: '^7.3.0' },
      devDependencies: { vitest: '^3.0.0', 'mongodb-memory-server': '^11.2.0' },
    });
  });

  it('patch value wins on scalar conflicts', () => {
    const result = jsonMerge({ a: 'old' }, { a: 'new' });
    expect(result.a).toBe('new');
  });

  it('deep-merges nested objects independently', () => {
    const target = { deps: { a: '1', b: '2' } };
    const patch = { deps: { b: '3', c: '4' } };
    const result = jsonMerge(target, patch);
    expect(result).toEqual({ deps: { a: '1', b: '3', c: '4' } });
  });

  it('replaces arrays rather than concatenating', () => {
    const result = jsonMerge({ keywords: ['foo'] }, { keywords: ['bar'] });
    expect(result.keywords).toEqual(['bar']);
  });

  it('is idempotent: applying the same patch twice yields the same result', () => {
    const target = { dependencies: { lodash: '^4.0.0' } };
    const patch = { dependencies: { mongodb: '^7.3.0' } };
    const once = jsonMerge(target, patch);
    const twice = jsonMerge(once, patch);
    expect(twice).toEqual(once);
  });

  it('does not mutate the target argument', () => {
    const target = { dependencies: { a: '1' } };
    const original = JSON.stringify(target);
    jsonMerge(target, { dependencies: { b: '2' } });
    expect(JSON.stringify(target)).toBe(original);
  });

  it('handles an empty patch (no-op)', () => {
    const target = { name: 'my-app' };
    expect(jsonMerge(target, {})).toEqual(target);
  });
});

// ---------------------------------------------------------------------------
// applyPatches — filesystem integration
// ---------------------------------------------------------------------------

describe('applyPatches', () => {
  let tmpDir: string;
  let templateDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'rrpatch-'));
    templateDir = join(tmpDir, 'template');
    projectDir = join(tmpDir, 'project');
    await mkdir(join(templateDir, 'patches'), { recursive: true });
    await mkdir(join(projectDir, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- ts-block-insert ---

  it('ts-block-insert: inserts rendered snippet into the named block', async () => {
    const configSource = `export default conf.defaults({
  datastores: {
    mongo: { type: "mongodb" },
  },
});`;
    await writeFile(join(projectDir, 'src', 'config.ts'), configSource);
    await writeFile(
      join(templateDir, 'patches', 'config.ts.hbs'),
      '    {{datastore}}: { type: "postgresql" },\n',
    );

    const patches: PatchEntry[] = [{
      template: 'patches/config.ts.hbs',
      target: 'src/config.ts',
      strategy: 'ts-block-insert',
      insertInto: 'datastores',
      idempotencyKey: '{{datastore}}',
    }];

    await applyPatches(templateDir, projectDir, { datastore: 'postgres' }, patches);

    const result = await readFile(join(projectDir, 'src', 'config.ts'), 'utf-8');
    expect(result).toContain('postgres: { type: "postgresql" }');
    expect(result).toContain('mongo: { type: "mongodb" }');
  });

  it('ts-block-insert: skips insertion when idempotencyKey is already present', async () => {
    const configSource = `export default { datastores: { mongo: { type: "mongodb" } } };`;
    await writeFile(join(projectDir, 'src', 'config.ts'), configSource);
    await writeFile(
      join(templateDir, 'patches', 'config.ts.hbs'),
      '    mongo: { type: "mongodb" },\n',
    );

    const patches: PatchEntry[] = [{
      template: 'patches/config.ts.hbs',
      target: 'src/config.ts',
      strategy: 'ts-block-insert',
      insertInto: 'datastores',
      idempotencyKey: '{{datastore}}',
    }];

    await applyPatches(templateDir, projectDir, { datastore: 'mongo' }, patches);

    // File should be unchanged
    const result = await readFile(join(projectDir, 'src', 'config.ts'), 'utf-8');
    expect(result).toBe(configSource);
  });

  it('ts-block-insert: throws when target file does not exist', async () => {
    await writeFile(join(templateDir, 'patches', 'frag.hbs'), 'some content');

    const patches: PatchEntry[] = [{
      template: 'patches/frag.hbs',
      target: 'src/missing.ts',
      strategy: 'ts-block-insert',
      insertInto: 'datastores',
    }];

    await expect(
      applyPatches(templateDir, projectDir, {}, patches),
    ).rejects.toThrow('not found');
  });

  // --- json-merge ---

  it('json-merge: merges dependency entries into existing package.json', async () => {
    const existing = { name: 'my-app', dependencies: { lodash: '^4.0.0' }, devDependencies: {} };
    await writeFile(join(projectDir, 'package.json'), JSON.stringify(existing, null, 2));
    await writeFile(
      join(templateDir, 'patches', 'deps.json'),
      JSON.stringify({ dependencies: { mongodb: '^7.3.0' }, devDependencies: { 'mongodb-memory-server': '^11.2.0' } }),
    );

    const patches: PatchEntry[] = [{
      template: 'patches/deps.json',
      target: 'package.json',
      strategy: 'json-merge',
    }];

    await applyPatches(templateDir, projectDir, {}, patches);

    const result = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8')) as Record<string, unknown>;
    expect((result.dependencies as Record<string, unknown>)['lodash']).toBe('^4.0.0');
    expect((result.dependencies as Record<string, unknown>)['mongodb']).toBe('^7.3.0');
    expect((result.devDependencies as Record<string, unknown>)['mongodb-memory-server']).toBe('^11.2.0');
  });

  it('json-merge: creates the file if it does not exist', async () => {
    await writeFile(
      join(templateDir, 'patches', 'deps.json'),
      JSON.stringify({ dependencies: { mongodb: '^7.3.0' } }),
    );

    const patches: PatchEntry[] = [{
      template: 'patches/deps.json',
      target: 'package.json',
      strategy: 'json-merge',
    }];

    await applyPatches(templateDir, projectDir, {}, patches);

    const result = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf-8')) as Record<string, unknown>;
    expect((result.dependencies as Record<string, unknown>)['mongodb']).toBe('^7.3.0');
  });

  it('json-merge: is idempotent — running twice yields the same result', async () => {
    const existing = { dependencies: { lodash: '^4.0.0' } };
    await writeFile(join(projectDir, 'package.json'), JSON.stringify(existing));
    await writeFile(
      join(templateDir, 'patches', 'deps.json'),
      JSON.stringify({ dependencies: { mongodb: '^7.3.0' } }),
    );

    const patches: PatchEntry[] = [{
      template: 'patches/deps.json',
      target: 'package.json',
      strategy: 'json-merge',
    }];

    await applyPatches(templateDir, projectDir, {}, patches);
    const after1 = await readFile(join(projectDir, 'package.json'), 'utf-8');

    await applyPatches(templateDir, projectDir, {}, patches);
    const after2 = await readFile(join(projectDir, 'package.json'), 'utf-8');

    expect(after1).toBe(after2);
  });

  // --- ts-property-set ---

  it('ts-property-set: replaces a property value in the named block', async () => {
    const configSource = `conf.defaults({ rbac: { enabled: false, } });`;
    await writeFile(join(projectDir, 'src', 'config.ts'), configSource);
    await writeFile(join(templateDir, 'patches', 'rbac.txt'), 'true');

    const patches: PatchEntry[] = [{
      template: 'patches/rbac.txt',
      target: 'src/config.ts',
      strategy: 'ts-property-set',
      insertInto: 'rbac',
      property: 'enabled',
    }];

    await applyPatches(templateDir, projectDir, {}, patches);

    const result = await readFile(join(projectDir, 'src', 'config.ts'), 'utf-8');
    expect(result).toContain('enabled: true');
    expect(result).not.toContain('enabled: false');
  });

  it('ts-property-set: is idempotent when property already has the desired value', async () => {
    const configSource = `conf.defaults({ rbac: { enabled: true, } });`;
    await writeFile(join(projectDir, 'src', 'config.ts'), configSource);
    await writeFile(join(templateDir, 'patches', 'rbac.txt'), 'true');

    const patches: PatchEntry[] = [{
      template: 'patches/rbac.txt',
      target: 'src/config.ts',
      strategy: 'ts-property-set',
      insertInto: 'rbac',
      property: 'enabled',
    }];

    await applyPatches(templateDir, projectDir, {}, patches);

    const result = await readFile(join(projectDir, 'src', 'config.ts'), 'utf-8');
    expect(result).toBe(configSource);
  });

  // --- condition gate ---

  it('skips a patch entirely when condition evaluates to falsy', async () => {
    const original = 'original content';
    await writeFile(join(projectDir, 'src', 'config.ts'), original);
    await writeFile(join(templateDir, 'patches', 'frag.hbs'), 'should not appear');

    const patches: PatchEntry[] = [{
      template: 'patches/frag.hbs',
      target: 'src/config.ts',
      strategy: 'ts-block-insert',
      insertInto: 'datastores',
      condition: 'datastore',      // context.datastore is '' → falsy
    }];

    await applyPatches(templateDir, projectDir, { datastore: '' }, patches);

    const result = await readFile(join(projectDir, 'src', 'config.ts'), 'utf-8');
    expect(result).toBe(original);
  });
});
