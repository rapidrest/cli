///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import { execFile } from 'child_process';
import os from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PostgresMemoryServer } from 'postgres-memory-server';
import { RedisMemoryServer } from 'redis-memory-server';

const execFileAsync = promisify(execFile);

export interface DatabaseConfig {
  mongodb: boolean;
  redis: boolean;
  postgresql: boolean;
}

export interface StartedDatabase {
  server: MongoMemoryServer | PostgresMemoryServer | RedisMemoryServer;
  type: "mongodb" | "redis" | "postgres";
  uri: string;
}

export interface StartedDatabases {
  databases: StartedDatabase[];
  env: Record<string, string>;
}

// Resolves the project's own tsx binary — the same one `dev` uses to run src/server.ts — so
// src/config.ts is executed as real TypeScript rather than text-scanned. A project is free to
// split its config across files (e.g. `src/config.ts` re-exporting from `./config.base.js`), and
// only actually importing the module follows re-exports/computed values correctly.
function resolveTsxBin(cwd: string): string {
  const ext = process.platform === 'win32' ? '.cmd' : '';
  return join(cwd, 'node_modules', '.bin', `tsx${ext}`);
}

// Imports src/config.ts in a short-lived tsx subprocess and returns the `type` of every entry
// under its `datastores` config block. Runs out-of-process (rather than importing directly here)
// since this CLI process has no TypeScript loader of its own — the project's tsx does.
async function loadDatastoreTypes(cwd: string): Promise<string[]> {
  const configPath = join(cwd, 'src', 'config.ts');
  await access(configPath);

  const probeDir = await mkdtemp(join(os.tmpdir(), 'rapidrest-config-probe-'));
  try {
    // Deliberately .ts, not .mjs: when tsx's entry point isn't itself TypeScript, a default
    // import of a .ts module gets double-wrapped (`{ default: [Getter] }`) instead of unwrapped.
    const probeScript = join(probeDir, 'probe.ts');
    const configUrl = pathToFileURL(configPath).href;
    await writeFile(
      probeScript,
      `import config from ${JSON.stringify(configUrl)};\n`
      + `const datastores = config.get('datastores') ?? {};\n`
      + `process.stdout.write(JSON.stringify(Object.values(datastores).map((d) => d && d.type)));\n`,
      'utf-8',
    );
    const { stdout } = await execFileAsync(
      resolveTsxBin(cwd),
      [probeScript],
      { cwd, shell: process.platform === 'win32' },
    );
    return JSON.parse(stdout.trim() || '[]');
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }
}

export async function detectDatabases(cwd: string): Promise<DatabaseConfig> {
  try {
    const types = await loadDatastoreTypes(cwd);
    return {
      mongodb: types.includes('mongodb'),
      redis: types.includes('redis'),
      // config.ts declares TypeORM's own driver literal ("postgres", not "postgresql" — see
      // typeorm's DatabaseType union), not the "postgresql" feature-flag name.
      postgresql: types.includes('postgres'),
    };
  } catch {
    return { mongodb: false, redis: false, postgresql: false };
  }
}

async function startMongoDB(): Promise<StartedDatabase> {
  const server = await MongoMemoryServer.create();
  const uri = server.getUri();
  return { server, type: "mongodb", uri };
}

async function startPostgres(): Promise<StartedDatabase> {
  const server = await PostgresMemoryServer.create();
  const uri = server.getUri();
  return { server, type: "postgres", uri };
}

async function startRedis(): Promise<StartedDatabase> {
  const server = new RedisMemoryServer();
  const host = await server.getHost();
  const port = await server.getPort();
  return { server, type: "redis", uri: `redis://${host}:${port}` };
}

export async function startDatabases(
  cwd: string,
  databases: DatabaseConfig,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): Promise<StartedDatabases> {
  const servers: StartedDatabase[] = [];
  const env: Record<string, string> = {};

  if (databases.mongodb) {
    log('Starting MongoDB...');
    try {
      const result = await startMongoDB();
      servers.push(result);
      // Override standard mongodb datastore host/port via nconf env vars
      for (const name of ['acl', 'mongo']) {
        env[`datastores__${name}__type`] = result.type;
        env[`datastores__${name}__url`] = result.uri;
      }
      log(`MongoDB is ready at uri: ${result.uri}`);
    } catch (e) {
      throw new Error(
        `Failed to start MongoDB: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  if (databases.redis) {
    log('Starting redis...');
    try {
      const result = await startRedis();
      servers.push(result);
      // Override standard redis datastore host/port via nconf env vars
      for (const name of ['cache','events','logs']) {
        env[`datastores__${name}__type`] = result.type;
        env[`datastores__${name}__url`] = result.uri;
      }
      log(`Redis is ready at uri: ${result.uri}`);
    } catch (e) {
      throw new Error(
        `Failed to start Redis: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  if (databases.postgresql) {
    log('Starting MongoDB...');
    try {
      const result = await startPostgres();
      servers.push(result);
      // Override standard postgres datastore host/port via nconf env vars
      env[`datastores__postgres__type`] = result.type;
      env[`datastores__postgres__url`] = result.uri;
      if (!databases.mongodb) {
        env[`datastores__acl__type`] = result.type;
        env[`datastores__acl__url`] = result.uri;
      }
      log(`Postgres is ready at uri: ${result.uri}`);
    } catch (e) {
      throw new Error(
        `Failed to start Postgres: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  return { databases: servers, env };
}
