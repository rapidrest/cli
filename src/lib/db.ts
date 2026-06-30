import { readFile } from 'fs/promises';
import { join } from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { PostgresMemoryServer } from 'postgres-memory-server';
import { RedisMemoryServer } from 'redis-memory-server';

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

export async function detectDatabases(cwd: string): Promise<DatabaseConfig> {
  try {
    const source = await readFile(join(cwd, 'src', 'config.ts'), 'utf-8');
    const hasType = (name: string) => new RegExp(`type:\\s*['"]${name}['"]`).test(source);
    return {
      mongodb: hasType('mongodb'),
      redis: hasType('redis'),
      postgresql: hasType('postgresql'),
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
  const host = server.getHost();
  const port = server.getPort();
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
        env[`datastores__${name}__url`] = result.uri;
      }
      log(`MongoDB is ready at url: ${result.uri}`);
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
        env[`datastores__${name}__url`] = result.uri;
      }
      log(`Redis is ready at ${result.uri}`);
    } catch (e) {
      throw new Error(
        `Failed to start MongoDB: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  if (databases.postgresql) {
    log('Starting MongoDB...');
    try {
      const result = await startPostgres();
      servers.push(result);
      // Override standard postgres datastore host/port via nconf env vars
      env[`datastores__postgres__url`] = result.uri;
      if (!databases.mongodb) {
        env[`datastores__acl__url`] = result.uri;
      }
      log(`Postgres is ready at url: ${result.uri}`);
    } catch (e) {
      throw new Error(
        `Failed to start MongoDB: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  return { databases: servers, env };
}
