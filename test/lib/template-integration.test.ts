///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
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
      expect(content).toContain('extends CRUDRoute<Product>');
      expect(content).toContain('CRUDRoute');
    });
  });

  it('generates a plain route (no model class) when model is empty', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(routeTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'ProductRoute.ts'), 'utf-8'));
      expect(content).not.toContain('extends CRUDRoute');
      expect(content).toContain('hello');
    });
  });

  it('uses the plain @Route decorator with no version when apiRoute is unset', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(routeTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'ProductRoute.ts'), 'utf-8'));
      expect(content).toContain('@Route("/api/v1/products")');
      expect(content).not.toContain('@ApiRoute');
    });
  });

  it('uses @ApiRoute with a version argument when apiRoute and apiVersion are set', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, apiRoute: true, apiVersion: '2' };
      await processTemplate(routeTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'ProductRoute.ts'), 'utf-8'));
      expect(content).toContain('@ApiRoute("/api/v1/products", "2")');
      expect(content).toContain('ApiRoute,');
      expect(content).not.toContain('    Route,');
    });
  });

  it('uses @ApiRoute with no version argument when apiRoute is set but apiVersion is empty', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, apiRoute: true, apiVersion: '' };
      await processTemplate(routeTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'ProductRoute.ts'), 'utf-8'));
      expect(content).toContain('@ApiRoute("/api/v1/products")');
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
      expect(files).toContain('/routes/ProductRoute.test.ts');
    });
  });

  it('includes mongo-specific imports when datastoreType is mongodb', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, model: 'Product', datastore: 'products', datastoreType: 'mongodb' };
      await processTemplate(testTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'routes', 'ProductRoute.test.ts'), 'utf-8'));
      expect(content).toContain('MongoConnection');
      expect(content).toContain('MongoMemoryServer');
    });
  });

  it('omits mongo-specific imports when datastoreType is not mongodb', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, model: 'Product', datastore: 'products', datastoreType: 'postgresql' };
      await processTemplate(testTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'routes', 'ProductRoute.test.ts'), 'utf-8'));
      expect(content).not.toContain('MongoConnection');
      expect(content).not.toContain('MongoMemoryServer');
    });
  });

  it('uses the bare path as baseUrl when apiRoute is unset', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(testTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'routes', 'ProductRoute.test.ts'), 'utf-8'));
      expect(content).toContain('const baseUrl = "/api/v1/products";');
    });
  });

  it('prefixes baseUrl with /api/v<version> when apiRoute and apiVersion are set', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, path: '/products', apiRoute: true, apiVersion: '2' };
      await processTemplate(testTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'routes', 'ProductRoute.test.ts'), 'utf-8'));
      expect(content).toContain('const baseUrl = "/api/v2/products";');
    });
  });

  it('prefixes baseUrl with /api (no version) when apiRoute is set but apiVersion is empty', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, path: '/products', apiRoute: true, apiVersion: '' };
      await processTemplate(testTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'routes', 'ProductRoute.test.ts'), 'utf-8'));
      expect(content).toContain('const baseUrl = "/api/products";');
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

// ─── job ──────────────────────────────────────────────────────────────────────

describe('generate job', () => {
  const jobTemplateDir = join(TEMPLATES, 'job');
  const baseContext = {
    name: 'MetricsCollector', author: 'Test', description: 'Collects metrics',
    schedule: '* * * * *', project_name: 'my-app', year: 2025,
  };

  it('generates the job source and test files with no scaffolding artifacts', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(jobTemplateDir, dir, baseContext, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/src/jobs/MetricsCollector.ts');
      expect(files).toContain('/test/jobs/MetricsCollector.test.ts');
      expect(files).not.toContain('/template.config.json');
    });
  });

  it('substitutes description, schedule, and author into the job source', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(jobTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'jobs', 'MetricsCollector.ts'), 'utf-8'));
      expect(content).toContain('Collects metrics');
      expect(content).toContain('return "* * * * *";');
      expect(content).toContain('@author Test');
      expect(content).toContain('class MetricsCollector extends BackgroundService');
    });
  });

  it('references the generated job class from the test file', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(jobTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'test', 'jobs', 'MetricsCollector.test.ts'), 'utf-8'));
      expect(content).toContain('import MetricsCollector from "../../src/jobs/MetricsCollector.js"');
      expect(content).toContain('describe("Job:MetricsCollector Tests"');
    });
  });
});

// ─── react ────────────────────────────────────────────────────────────────────

describe('generate react', () => {
  const reactTemplateDir = join(TEMPLATES, 'react');
  const baseContext = {
    name: 'dashboard', className: 'Dashboard', author: 'Test', hydrate: false,
    path: '/dashboard', project_name: 'my-app', year: 2025,
  };

  it('generates app and route files with no scaffolding artifacts', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(reactTemplateDir, dir, baseContext, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/src/routes/DashboardRoute.ts');
      expect(files).toContain('/apps/dashboard/index.tsx');
      expect(files).toContain('/apps/dashboard/_layout.tsx');
      // vite.config.ts, tsconfig.client.json and src/export.ts are NOT produced by the template —
      // their content depends on every app in the project (global state Handlebars can't see), so
      // GenerateReact.run() generates them directly. See src/commands/generate/react.ts.
      expect(files).not.toContain('/vite.config.ts');
      expect(files).not.toContain('/tsconfig.client.json');
      expect(files).not.toContain('/src/export.ts');
      expect(files).not.toContain('/template.config.json');
      expect(files.every(f => !f.startsWith('/patches/'))).toBe(true);
    });
  });

  it('merges react dependencies into package.json via patch', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(reactTemplateDir, dir, baseContext, { projectDir: dir });
      const pkg = JSON.parse(await import('fs/promises').then(fs => fs.readFile(join(dir, 'package.json'), 'utf-8')));
      // The react patches/package.json adds react dependencies and an "export" script
      expect(pkg).toBeDefined();
      expect(pkg.scripts.export).toBe('rapidrest react export');
    });
  });
});

// ─── react-page ───────────────────────────────────────────────────────────────

describe('generate react-page', () => {
  const reactPageTemplateDir = join(TEMPLATES, 'react-page');
  const baseContext = {
    app: 'app', name: 'Dashboard', className: 'Dashboard', author: 'Test',
    project_name: 'my-app', service: true, year: 2025,
  };

  it('generates the page component under apps/<app>/<name>/index.tsx and a flat service class, with no scaffolding artifacts', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(reactPageTemplateDir, dir, baseContext, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/apps/app/Dashboard/index.tsx');
      expect(files).toContain('/src/services/DashboardService.ts');
      expect(files).not.toContain('/template.config.json');
    });
  });

  it('omits the service class when service is disabled', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, service: false };
      await processTemplate(reactPageTemplateDir, dir, ctx, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/apps/app/Dashboard/index.tsx');
      expect(files).not.toContain('/src/services/DashboardService.ts');
    });
  });

  it('omits the client-side fetchProps helper when a service class is used', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(reactPageTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'apps', 'app', 'Dashboard', 'index.tsx'), 'utf-8'));
      expect(content).not.toContain('export async function fetchProps');
      expect(content).toContain('export default function Dashboard()');
    });
  });

  it('includes the client-side fetchProps helper when no service class is used', async () => {
    await withTmpDir(async (dir) => {
      const ctx = { ...baseContext, service: false };
      await processTemplate(reactPageTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'apps', 'app', 'Dashboard', 'index.tsx'), 'utf-8'));
      expect(content).toContain('export async function fetchProps');
    });
  });

  it('substitutes app, name, and author into the generated service class', async () => {
    await withTmpDir(async (dir) => {
      await processTemplate(reactPageTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'services', 'DashboardService.ts'), 'utf-8'));
      expect(content).toContain('@ReactService("app/Dashboard")');
      expect(content).toContain('export default class DashboardService');
      expect(content).toContain('@author Test');
      expect(content).toContain("app's Dashboard page");
    });
  });

  describe('nested page paths', () => {
    const nestedContext = { ...baseContext, name: 'my/path/page', className: 'MyPathPage' };

    it('nests the page component under the full subpath while keeping the service class flat', async () => {
      await withTmpDir(async (dir) => {
        await processTemplate(reactPageTemplateDir, dir, nestedContext, { projectDir: dir });
        const files = await listFiles(dir);
        expect(files).toContain('/apps/app/my/path/page/index.tsx');
        expect(files).toContain('/src/services/MyPathPageService.ts');
      });
    });

    it('uses the PascalCased className for the component and service identifiers', async () => {
      await withTmpDir(async (dir) => {
        await processTemplate(reactPageTemplateDir, dir, nestedContext, { projectDir: dir });
        const pageContent = await import('fs/promises').then(fs => fs.readFile(join(dir, 'apps', 'app', 'my', 'path', 'page', 'index.tsx'), 'utf-8'));
        expect(pageContent).toContain('export default function MyPathPage()');

        const serviceContent = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'services', 'MyPathPageService.ts'), 'utf-8'));
        expect(serviceContent).toContain('@ReactService("app/my/path/page")');
        expect(serviceContent).toContain('export default class MyPathPageService');
      });
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

  it('includes GitHub CI workflow when scm.github is enabled', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeServerContext({ scm: { github: true, gitlab: false, git: false } });
      await processTemplate(serverTemplateDir, dir, ctx, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files.some(f => f.includes('.github'))).toBe(true);
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

  describe('apiRoute prefix', () => {
    it('uses the plain @Route decorator when apiRoute is unset', async () => {
      await withTmpDir(async (dir) => {
        const ctx = makeServerContext();
        await processTemplate(serverTemplateDir, dir, ctx, { projectDir: dir });
        const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'routes', 'HelloRoute.ts'), 'utf-8'));
        expect(content).toContain('@Route("/hello")');
        expect(content).not.toContain('@ApiRoute');
      });
    });

    it('uses @ApiRoute with a version on the generated Hello route when apiRoute is set', async () => {
      await withTmpDir(async (dir) => {
        const ctx = makeServerContext({ apiRoute: true, apiVersion: '1' });
        await processTemplate(serverTemplateDir, dir, ctx, { projectDir: dir });
        const readFile = (p: string) => import('fs/promises').then(fs => fs.readFile(join(dir, ...p.split('/')), 'utf-8'));
        expect(await readFile('src/routes/HelloRoute.ts')).toContain('@ApiRoute("/hello", "1")');
      });
    });
  });
});

// ─── default-route ───────────────────────────────────────────────────────────

describe('generate default-route', () => {
  const defaultRouteTemplateDir = join(TEMPLATES, 'default-route');

  function makeContext(overrides: Record<string, unknown> = {}) {
    return {
      author: 'Test', year: 2025,
      apiRoute: false, apiVersion: undefined,
      features: { mongodb: false },
      hasACLRoute: false, hasAdminRoute: false, hasMetricsRoute: false,
      hasOpenAPIRoute: false, hasPushRoute: false, hasStaticRoute: false, hasStatusRoute: false,
      staticPath: 'public',
      ...overrides,
    };
  }

  it('only generates the route files corresponding to the enabled hasXRoute flags', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeContext({ hasAdminRoute: true, hasStatusRoute: true });
      await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/src/routes/AdminRoute.ts');
      expect(files).toContain('/src/routes/StatusRoute.ts');
      expect(files).not.toContain('/src/routes/ACLRoute.ts');
      expect(files).not.toContain('/src/routes/MetricsRoute.ts');
      expect(files).not.toContain('/src/routes/OpenAPIRoute.ts');
      expect(files).not.toContain('/src/routes/PushRoute.ts');
      expect(files).not.toContain('/template.config.json');
    });
  });

  it('renders the SQL ACL variant when features.mongodb is false', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeContext({ hasACLRoute: true, features: { mongodb: false } });
      await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'routes', 'ACLRoute.ts'), 'utf-8'));
      expect(content).toContain('AccessControlListSQL');
      expect(content).not.toContain('AccessControlListMongo');
    });
  });

  it('renders the Mongo ACL variant when features.mongodb is true', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeContext({ hasACLRoute: true, features: { mongodb: true } });
      await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'routes', 'ACLRoute.ts'), 'utf-8'));
      expect(content).toContain('AccessControlListMongo');
      expect(content).not.toContain('AccessControlListSQL');
    });
  });

  it('uses @ApiRoute with a version on every generated route when apiRoute is set', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeContext({
        apiRoute: true, apiVersion: '1',
        hasACLRoute: true, hasAdminRoute: true, hasMetricsRoute: true,
        hasOpenAPIRoute: true, hasPushRoute: true, hasStatusRoute: true,
      });
      await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir });
      const readFile = (p: string) => import('fs/promises').then(fs => fs.readFile(join(dir, ...p.split('/')), 'utf-8'));
      expect(await readFile('src/routes/ACLRoute.ts')).toContain('@ApiRoute("/acls", "1")');
      expect(await readFile('src/routes/AdminRoute.ts')).toContain('@ApiRoute("/admin", "1")');
      expect(await readFile('src/routes/MetricsRoute.ts')).toContain('@ApiRoute("/metrics", "1")');
      expect(await readFile('src/routes/OpenAPIRoute.ts')).toContain('@ApiRoute("/openapi", "1")');
      expect(await readFile('src/routes/PushRoute.ts')).toContain('@ApiRoute("/push", "1")');
      expect(await readFile('src/routes/StatusRoute.ts')).toContain('@ApiRoute("/status", "1")');
    });
  });

  it('uses the plain @Route decorator when apiRoute is unset', async () => {
    await withTmpDir(async (dir) => {
      const ctx = makeContext({ hasStatusRoute: true });
      await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'routes', 'StatusRoute.ts'), 'utf-8'));
      expect(content).toContain('@Route("/status")');
      expect(content).not.toContain('@ApiRoute');
    });
  });

  it('generates StaticRoute.ts when hasStaticRoute is true', async () => {
    await withTmpDir(async (dir) => {
      // hasStaticRoute also gates the config.ts patch, so a patch target must exist.
      await mkdir(join(dir, 'src'), { recursive: true });
      await writeFile(join(dir, 'src', 'config.ts'), 'conf.defaults({\n});\n', 'utf-8');

      const ctx = makeContext({ hasStaticRoute: true });
      await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir });
      const files = await listFiles(dir);
      expect(files).toContain('/src/routes/StaticRoute.ts');
    });
  });

  describe('static route config.ts patch', () => {
    // A trimmed-down but structurally faithful stand-in for templates/server/src/config.ts —
    // a `.defaults({ ... })` call with a named `auth` block, so the test can assert the
    // inserted property lands as a top-level sibling rather than nested inside `auth`.
    const baseConfigSource = `import nconf from "nconf";

const conf = nconf.argv();

conf.defaults({
    service_name: "my-app",
    auth: {
        strategy: "auth.JWTStrategy",
        secret: "MyPasswordIsSecure",
    },
    cors: {
        origin: ["http://localhost:3000"],
    },
});

export default conf;
`;

    async function withConfigFile(fn: (dir: string) => Promise<void>): Promise<void> {
      await withTmpDir(async (dir) => {
        await mkdir(join(dir, 'src'), { recursive: true });
        await writeFile(join(dir, 'src', 'config.ts'), baseConfigSource, 'utf-8');
        await fn(dir);
      });
    }

    it('inserts static_files as a top-level property, not nested inside another block', async () => {
      await withConfigFile(async (dir) => {
        const ctx = makeContext({ hasStaticRoute: true, staticPath: 'assets' });
        await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir });

        const patched = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'config.ts'), 'utf-8'));
        expect(patched).toContain('static_files: "assets",');

        const authBlock = patched.slice(patched.indexOf('auth: {'), patched.indexOf('cors: {'));
        expect(authBlock).not.toContain('static_files');

        // Lands immediately before the closing of the conf.defaults({ ... }) call
        expect(patched).toContain('static_files: "assets",\n});');
      });
    });

    it('does not patch config.ts when hasStaticRoute is false', async () => {
      await withConfigFile(async (dir) => {
        const ctx = makeContext({ hasStaticRoute: false });
        await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir });

        const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'config.ts'), 'utf-8'));
        expect(content).toBe(baseConfigSource);
      });
    });

    it('is idempotent — re-running the patch does not insert a duplicate static_files property', async () => {
      await withConfigFile(async (dir) => {
        const ctx = makeContext({ hasStaticRoute: true, staticPath: 'assets' });
        await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir, force: true });
        await processTemplate(defaultRouteTemplateDir, dir, ctx, { projectDir: dir, force: true });

        const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'src', 'config.ts'), 'utf-8'));
        const matches = content.match(/static_files:/g) ?? [];
        expect(matches.length).toBe(1);
      });
    });
  });
});

// ─── helm ─────────────────────────────────────────────────────────────────────
//
// Regression coverage for a real bug: templates/helm/template.config.json shipped with
// `"helmPaths": []`, which silently made every file under templates/helm/helm/ go through plain
// Handlebars instead of the `[[ ]]`-safe substitution its own `[[project_name]]`/`{{ .Values.x }}`
// mix requires - Handlebars either left `[[project_name]]` completely unsubstituted (for files with
// no Go-template syntax) or threw a hard parse error (for every file that also has Helm's own `{{ }}`
// syntax, which is the majority of this chart). This exercises the *real* templates/helm directory end
// to end (mirroring what `generate k8s` actually does), not a synthetic fixture, specifically so a
// regression here (e.g. someone clearing helmPaths again) fails a test instead of only surfacing the
// next time someone actually runs `rapidrest generate k8s` against a real project.

describe('generate k8s — helm template (regression: helmPaths must stay non-empty)', () => {
  const helmTemplateDir = join(TEMPLATES, 'helm');
  const baseContext = {
    year: 2026,
    project_name: 'my-test-project',
    datastores: [{ name: 'mongo', type: 'mongodb' }, { name: 'cache', type: 'redis' }],
    hasMongoDB: true,
    hasPostgres: false,
    hasRedis: true,
  };

  // templates/helm/template.config.json patches package.json (json-merge) - needs a real target file.
  async function withPackageJson(fn: (dir: string) => Promise<void>): Promise<void> {
    await withTmpDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'my-test-project', scripts: {} }, null, 2));
      await fn(dir);
    });
  }

  it('renders without throwing', async () => {
    await withPackageJson(async (dir) => {
      await expect(processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir })).resolves.not.toThrow();
    });
  });

  it('substitutes [[ ]] placeholders - no file is left containing literal [[project_name]] or [[name]]', async () => {
    await withPackageJson(async (dir) => {
      await processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir });
      const files = (await listFiles(dir)).filter(f => f.startsWith('/helm/'));
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const content = await import('fs/promises').then(fs => fs.readFile(join(dir, f), 'utf-8'));
        expect(content, `${f} still contains an unsubstituted [[ ]] placeholder`).not.toMatch(/\[\[\s*[\w.]+\s*\]\]/);
      }
    });
  });

  it('resolves Chart.yaml\'s name to the real project name, not blank', async () => {
    await withPackageJson(async (dir) => {
      await processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'helm', 'Chart.yaml'), 'utf-8'));
      expect(content).toContain('name: my-test-project');
    });
  });

  it('resolves the Deployment/Service names to <project_name>-services, not a bare "-services"', async () => {
    await withPackageJson(async (dir) => {
      await processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir });
      const deployment = await import('fs/promises').then(fs =>
        fs.readFile(join(dir, 'helm', 'templates', '1_deployments', 'service.yaml'), 'utf-8'));
      expect(deployment).toContain('name: my-test-project-services');
      expect(deployment).not.toMatch(/name: -services/);
    });
  });

  it('leaves Helm\'s own {{ }} Go-template syntax untouched for Helm to render later', async () => {
    await withPackageJson(async (dir) => {
      await processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir });
      const deployment = await import('fs/promises').then(fs =>
        fs.readFile(join(dir, 'helm', 'templates', '1_deployments', 'service.yaml'), 'utf-8'));
      expect(deployment).toContain('{{ $.Values.environment }}');
      expect(deployment).toContain('{{- if $.Values.redis.create }}');
    });
  });
});

// The chart lets an operator toggle between the mongodb and postgresql subcharts at install time
// (`--set mongodb.create=`/`--set postgresql.create=`), since the app itself picks its datastore
// backend from env vars at runtime (see server.ts's `datastores__sql__url` check). Both dependencies
// and both values.yaml blocks are always scaffolded together so the swap works regardless of which
// backend was chosen at `generate k8s` time - this exercises the postgres-only side of that (the
// mongo-only side is covered by the describe block above).
describe('generate k8s — helm template (PostgreSQL support)', () => {
  const helmTemplateDir = join(TEMPLATES, 'helm');
  const baseContext = {
    year: 2026,
    project_name: 'my-test-project',
    datastores: [{ name: 'sql', type: 'postgres' }],
    hasMongoDB: false,
    hasPostgres: true,
    hasRedis: false,
  };

  async function withPackageJson(fn: (dir: string) => Promise<void>): Promise<void> {
    await withTmpDir(async (dir) => {
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'my-test-project', scripts: {} }, null, 2));
      await fn(dir);
    });
  }

  it('renders without throwing and leaves no unsubstituted [[ ]] placeholder', async () => {
    await withPackageJson(async (dir) => {
      await expect(processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir })).resolves.not.toThrow();
      const files = (await listFiles(dir)).filter(f => f.startsWith('/helm/'));
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const content = await import('fs/promises').then(fs => fs.readFile(join(dir, f), 'utf-8'));
        expect(content, `${f} still contains an unsubstituted [[ ]] placeholder`).not.toMatch(/\[\[\s*[\w.]+\s*\]\]/);
      }
    });
  });

  it('lists both mongodb and postgresql as chart dependencies regardless of which was scaffolded', async () => {
    await withPackageJson(async (dir) => {
      await processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'helm', 'Chart.yaml'), 'utf-8'));
      expect(content).toContain('- name: mongodb');
      expect(content).toContain('- name: postgresql');
      expect(content).toContain('condition: postgresql.create');
    });
  });

  it('defaults postgresql.create to true and omits mongodb.create when postgres was scaffolded', async () => {
    await withPackageJson(async (dir) => {
      await processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs => fs.readFile(join(dir, 'helm', 'values.yaml'), 'utf-8'));
      const postgresBlock = content.slice(content.indexOf('postgresql:'));
      expect(postgresBlock).toMatch(/postgresql:\s*\n\s*create: true/);
      const mongoBlock = content.slice(content.indexOf('mongodb:'), content.indexOf('postgresql:'));
      expect(mongoBlock).not.toContain('create: true');
    });
  });

  it('wires a postgres-probe init container guarded by $.Values.postgresql.create', async () => {
    // service.yaml is under helmPaths too, so both the mongo-probe and postgres-probe blocks
    // (each guarded by its own Helm {{- if }}) are expected in the emitted source untouched -
    // which one actually runs is a chart *install*-time decision, not a CLI scaffold-time one.
    await withPackageJson(async (dir) => {
      await processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir });
      const deployment = await import('fs/promises').then(fs =>
        fs.readFile(join(dir, 'helm', 'templates', '1_deployments', 'service.yaml'), 'utf-8'));
      expect(deployment).toContain('{{- if $.Values.postgresql.create }}');
      expect(deployment).toContain('name: postgres-probe');
      expect(deployment).toContain('nc -z $POSTGRES_HOST 5432');
    });
  });

  it('wires the acl and sql datastores from the postgresql subchart in service-config.yaml', async () => {
    // service-config.yaml is under helmPaths, so its own Helm {{ }} if/else-if (which chooses
    // mongo vs. postgres for the acl datastore at chart *install* time, not CLI *scaffold* time)
    // passes through untouched - both branches are expected to be present in the emitted source.
    await withPackageJson(async (dir) => {
      await processTemplate(helmTemplateDir, dir, baseContext, { projectDir: dir });
      const content = await import('fs/promises').then(fs =>
        fs.readFile(join(dir, 'helm', 'templates', '0_config', 'service-config.yaml'), 'utf-8'));
      expect(content).toContain('{{- else if $.Values.postgresql.create }}');
      expect(content).toContain('datastores__acl__type: {{ print "postgres" | b64enc | quote }}');
      expect(content).toContain('datastores__sql__type: {{ print "postgres" | b64enc | quote }}');
    });
  });
});
