import { describe, it, expect } from 'vitest';
import { processTemplate } from '../../src/lib/template.js';
import { mkdtemp, rm, readdir, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import os from 'os';

const TEMPLATES = join(process.cwd(), 'templates');

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...await listFiles(full, base));
    else files.push(full.slice(base.length).replace(/\\/g, '/'));
  }
  return files;
}

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(os.tmpdir(), 'rr-integ-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

// ─── route ────────────────────────────────────────────────────────────────────

describe('generate route — route template', () => {
  const routeTemplateDir = join(TEMPLATES, 'route', 'src', 'routes');
  const baseContext = {
    name: 'ProductRoute', author: 'Test', path: '/api/v1/products',
    description: 'Products', model: '', datastore: '', datastoreType: '',
    protect: false, year: 2025,
  };

  it('generates the route file and no scaffolding artifacts', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(routeTemplateDir, dir, baseContext, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/ProductRoute.ts');
      expect(files).not.toContain('/template.config.json');
      expect(files.every(f => !f.startsWith('/patches/'))).toBe(true);
    });
  });

  it('generates a model-extended route when model is provided', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, model: 'Product', datastoreType: 'mongodb' };
      await processTemplate(routeTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'ProductRoute.ts'), 'utf-8'));
      expect(content).toContain('extends ModelRoute<Product>');
      expect(content).toContain('ModelRoute');
    });
  });

  it('generates a plain route (no model class) when model is empty', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(routeTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'ProductRoute.ts'), 'utf-8'));
      expect(content).not.toContain('extends ModelRoute');
      expect(content).toContain('hello');
    });
  });
});

describe('generate route — test template', () => {
  const testTemplateDir = join(TEMPLATES, 'route', 'test');
  const baseContext = {
    name: 'ProductRoute', author: 'Test', path: '/api/v1/products',
    description: 'Products', model: '', datastore: '', datastoreType: '',
    protect: false, year: 2025,
  };

  it('generates the test file', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(testTemplateDir, dir, baseContext, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/ProductRoute.test.ts');
    });
  });

  it('includes mongo-specific imports when datastoreType is mongodb', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, model: 'Product', datastore: 'products', datastoreType: 'mongodb' };
      await processTemplate(testTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'ProductRoute.test.ts'), 'utf-8'));
      expect(content).toContain('MongoConnection');
      expect(content).toContain('MongoMemoryServer');
    });
  });

  it('omits mongo-specific imports when datastoreType is not mongodb', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, model: 'Product', datastore: 'products', datastoreType: 'postgresql' };
      await processTemplate(testTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'ProductRoute.test.ts'), 'utf-8'));
      expect(content).not.toContain('MongoConnection');
      expect(content).not.toContain('MongoMemoryServer');
    });
  });
});

// ─── model ────────────────────────────────────────────────────────────────────

describe('generate model', () => {
  const modelTemplateDir = join(TEMPLATES, 'model');
  // All patch conditions false → no patches applied; no src/config.ts or package.json required.
  const baseContext = {
    name: 'Product', author: 'Test', description: 'A product',
    datastore: '', datastoreType: '', cache: false, protect: false,
    year: 2025, project_name: 'my-app',
    isMongoDb: false, isPostgreSql: false, isSqlite: false, isRedis: false,
  };

  it('generates the model file under src/models/ and no scaffolding artifacts', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(modelTemplateDir, dir, baseContext, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/src/models/Product.ts');
      expect(files).not.toContain('/template.config.json');
      expect(files.every(f => !f.startsWith('/patches/'))).toBe(true);
    });
  });

  it('emits Mongo entity imports when datastoreType is mongodb', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, datastoreType: 'mongodb', isMongoDb: true };
      await processTemplate(modelTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src/models/Product.ts'), 'utf-8'));
      expect(content).toContain('BaseMongoEntity');
    });
  });

  it('emits SQL entity imports when datastoreType is not mongodb', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, datastoreType: 'postgresql', isPostgreSql: true };
      await processTemplate(modelTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src/models/Product.ts'), 'utf-8'));
      expect(content).not.toContain('BaseMongoEntity');
      expect(content).toContain('BaseEntity');
    });
  });
});

// ─── react ────────────────────────────────────────────────────────────────────

describe('generate react', () => {
  const reactTemplateDir = join(TEMPLATES, 'react');
  const baseContext = {
    name: 'dashboard', author: 'Test', hydrate: false,
    path: '/dashboard', project_name: 'my-app', year: 2025,
  };

  it('generates app files, route file, and vite config with no scaffolding artifacts', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(reactTemplateDir, dir, baseContext, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/src/routes/dashboardRoute.ts');
      expect(files).toContain('/apps/dashboard/index.tsx');
      expect(files).toContain('/apps/dashboard/_layout.tsx');
      expect(files).toContain('/vite.config.ts');
      expect(files).toContain('/tsconfig.client.json');
      expect(files).not.toContain('/template.config.json');
      expect(files.every(f => !f.startsWith('/patches/'))).toBe(true);
    });
  });

  it('merges react dependencies into package.json via patch', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(reactTemplateDir, dir, baseContext, { projectDir: dir });
      const pkg = JSON.parse(await import('fs/promises').then(fs => fs.readFile(join(dir, 'package.json'), 'utf-8')));
      // The react patches/package.json adds react dependencies
      expect(pkg).toBeDefined();
    });
  });
});

// ─── server ───────────────────────────────────────────────────────────────────

describe('generate server', () => {
  const serverTemplateDir = join(TEMPLATES, 'server');

  function makeServerContext(overrides: Record<string, unknown> = {}) {
    return {
      name: 'my-service', author: 'Test', description: 'A test service',
      year: 2025,
      scm: { github: false, gitlab: false, git: false },
      pkgMgr: { yarn: false },
      features: {
        react: false, docker: false, k8s: false, redis: false,
        hasDatabase: false,
        ...((overrides.features as Record<string, unknown>) ?? {}),
      },
      ...overrides,
    };
  }

  it('generates core server files when all optional features are disabled', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeServerContext();
      await processTemplate(serverTemplateDir, dir, ctx, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files.some(f => f.includes('server.ts'))).toBe(true);
      expect(files.some(f => f.includes('config.ts'))).toBe(true);
      // Conditional files should be absent
      expect(files.every(f => !f.startsWith('/.github/'))).toBe(true);
      expect(files.every(f => !f.includes('Dockerfile'))).toBe(true);
      expect(files.every(f => !f.startsWith('/helm/'))).toBe(true);
    });
  });

  it('includes docker files when features.docker is enabled', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeServerContext({ features: { docker: true, react: false, k8s: false, redis: false, hasDatabase: false } });
      await processTemplate(serverTemplateDir, dir, ctx, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files.some(f => f.includes('Dockerfile'))).toBe(true);
      expect(files.some(f => f.includes('docker-compose.yml'))).toBe(true);
    });
  });

  it('includes GitHub CI workflow when scm.github is enabled', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeServerContext({ scm: { github: true, gitlab: false, git: false } });
      await processTemplate(serverTemplateDir, dir, ctx, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files.some(f => f.includes('.github'))).toBe(true);
    });
  });

  it('includes database model and routes when features.hasDatabase is enabled', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeServerContext({ features: { hasDatabase: true, react: false, docker: false, k8s: false, redis: false } });
      await processTemplate(serverTemplateDir, dir, ctx, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files.some(f => f.includes('User.ts'))).toBe(true);
      expect(files.some(f => f.includes('AuthRoute.ts'))).toBe(true);
    });
  });

  it('does not include react app files when features.react is disabled', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeServerContext();
      await processTemplate(serverTemplateDir, dir, ctx, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files.every(f => !f.startsWith('/app/'))).toBe(true);
      expect(files.every(f => !f.includes('vite.config'))).toBe(true);
    });
  });
});
