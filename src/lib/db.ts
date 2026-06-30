import { readFile } from 'fs/promises';
import { join } from 'path';
import { spawn, type ChildProcess } from 'child_process';
import net from 'net';

export interface DatabaseConfig {
  mongodb: boolean;
  redis: boolean;
  postgresql: boolean;
}

export interface StartedDatabases {
  processes: ChildProcess[];
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

function portListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: '127.0.0.1' });
    sock.setTimeout(500);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
  });
}

// Inline ESM script executed inside the target project so it can import
// mongodb-memory-server from that project's node_modules.
const MONGO_START_SCRIPT = `
import { MongoMemoryServer } from 'mongodb-memory-server';
const server = await MongoMemoryServer.create();
const port = new URL(server.getUri()).port;
process.stdout.write(JSON.stringify({ port }) + '\\n');
const stop = async () => { await server.stop(); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
await new Promise(() => {});
`.trim();

async function spawnMongoDB(cwd: string): Promise<{ child: ChildProcess; port: string }> {
  const child = spawn(process.execPath, ['--input-type=module'], {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  child.stdin!.write(MONGO_START_SCRIPT + '\n');
  child.stdin!.end();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('MongoDB startup timed out after 60 s'));
    }, 60_000);

    let buf = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timeout);
        try {
          const { port } = JSON.parse(buf.slice(0, nl)) as { port: string };
          resolve({ child, port });
        } catch {
          reject(new Error(`Unexpected MongoDB startup output: ${buf.slice(0, nl)}`));
        }
      }
    });

    child.once('error', (err) => { clearTimeout(timeout); reject(err); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`MongoDB process exited early with code ${code}`));
      }
    });
  });
}

export async function startDatabases(
  cwd: string,
  databases: DatabaseConfig,
  log: (msg: string) => void,
  warn: (msg: string) => void,
): Promise<StartedDatabases> {
  const processes: ChildProcess[] = [];
  const env: Record<string, string> = {};

  if (databases.mongodb) {
    log('Starting MongoDB (mongodb-memory-server)...');
    try {
      const { child, port } = await spawnMongoDB(cwd);
      processes.push(child);
      // Override standard RapidREST MongoDB datastore host/port via nconf env vars
      for (const name of ['ACL', 'MONGO']) {
        env[`DATASTORES__${name}__HOST`] = 'localhost';
        env[`DATASTORES__${name}__PORT`] = port;
      }
      log(`MongoDB ready on port ${port}`);
    } catch (e) {
      throw new Error(
        `Failed to start MongoDB: ${e instanceof Error ? e.message : String(e)}\n` +
        `Ensure mongodb-memory-server is installed in this project (npm install --save-dev mongodb-memory-server).`,
      );
    }
  }

  if (databases.redis) {
    const up = await portListening(6379);
    if (up) {
      log('Redis detected on localhost:6379');
    } else {
      warn('Redis not found on localhost:6379 — cache/event features may fail.');
      warn('  Tip: docker run -d -p 6379:6379 redis:alpine');
    }
  }

  if (databases.postgresql) {
    const up = await portListening(5432);
    if (up) {
      log('PostgreSQL detected on localhost:5432');
    } else {
      warn('PostgreSQL not found on localhost:5432 — database features may fail.');
      warn('  Tip: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:alpine');
    }
  }

  return { processes, env };
}
