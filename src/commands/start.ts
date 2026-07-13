import { Command, Flags } from '@oclif/core';
import { existsSync } from 'fs';
import { join, delimiter } from 'path';
import { spawn } from 'child_process';
import { detectDatabases, startDatabases, StartedDatabase } from '../lib/db.js';
import { detectPackageManager, detectReact } from '../lib/project.js';
import { findAvailablePort } from '../lib/port.js';

function detectServerPath(cwd: string): string {
  if (existsSync(join(cwd, "dist", "server", "server.js"))) {
    return join("dist", "server", "server.js");
  } else if (existsSync(join(cwd, "dist", "src", "server.js"))) {
    return join("dist", "src", "server.js");
  }
  return join("dist", "server.js");
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: true });
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`));
    });
    child.once('error', reject);
  });
}

export default class Start extends Command {
  static override description = 'Build and start the RapidREST server with in-memory database services.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --no-build',
  ];

  static override flags = {
    bun: Flags.boolean({ description: "Use the Bun engine instead of Node.js" }),
    docker: Flags.boolean({ char: 'd', description: 'Run in Docker mode (skips embedded databases).' }),
    'no-build': Flags.boolean({ description: 'Skip the build step.' }),
    port: Flags.integer({ char: 'p', description: 'Preferred port to bind to. If already in use, the next available port is used instead.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Start);
    const cwd = process.cwd();
    const projectBin = join(cwd, 'node_modules', '.bin');
    const ext = process.platform === 'win32' ? '.cmd' : '';

    // 1. Build
    if (!flags['no-build']) {
      const pkgMgr = await detectPackageManager(cwd);
      this.log('Building project...');
      try {
        const args = pkgMgr === 'yarn' ? ['build'] : ['run', 'build'];
        await runCommand(pkgMgr, args, cwd);
      } catch (e) {
        this.error(e instanceof Error ? e.message : String(e));
      }

      // 1b. Build React frontend (vite build) if configured
      if (await detectReact(cwd)) {
        this.log('Building React frontend...');
        try {
          await runCommand(join(projectBin, `vite${ext}`), ['build'], cwd);
        } catch (e) {
          this.error(e instanceof Error ? e.message : String(e));
        }
      }
    }

    this.log('\nStarting RapidREST server...');

    // 2. Start databases
    let dbProcesses: StartedDatabase[] = [];
    let dbEnv: Record<string, string> = {};
    if (!flags.docker) {
      const databases = await detectDatabases(cwd);
      try {
        const result = await startDatabases(cwd, databases, (m) => this.log(m), (m) => this.warn(m));
        dbProcesses = result.databases;
        dbEnv = result.env;
      } catch (e) {
        this.error(e instanceof Error ? e.message : String(e));
      }
    } else {
      this.log("Docker mode enabled.");
    }

    // 3. Find an available port, starting from the preferred/default port
    const basePort = flags.port ?? (Number(process.env.port) || 3000);
    const port = await findAvailablePort(basePort);
    if (port !== basePort) {
      this.warn(`Port ${basePort} is already in use. Using port ${port} instead.`);
    }

    // 4. Start server
    const serverPath: string = detectServerPath(cwd);
    this.log('\nStarting RapidREST server...');
    const serverEnv = { ...process.env, ...dbEnv, port: String(port) };
    const server = spawn(flags.bun ? 'bun' : process.execPath, [serverPath], {
      cwd,
      stdio: 'inherit',
      env: serverEnv,
    });

    // 5. Forward signals and clean up
    const cleanup = async () => {
      server.kill();
      for (const db of dbProcesses) {
        this.log(`Stopping database ${db.type}...`);
        await db.server.stop();
      }
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    await new Promise<void>((resolve) => { server.once('exit', resolve); });
    await cleanup();
  }
}
