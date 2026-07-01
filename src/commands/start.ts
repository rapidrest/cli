import { Command, Flags } from '@oclif/core';
import { existsSync } from 'fs';
import { access, readFile } from 'fs/promises';
import { join, delimiter } from 'path';
import { spawn } from 'child_process';
import { detectDatabases, startDatabases, StartedDatabase } from '../lib/db.js';
import { detectReact } from '../lib/project.js';

async function detectPackageManager(cwd: string): Promise<'npm' | 'yarn'> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { packageManager?: string };
    if (pkg.packageManager?.startsWith('yarn')) return 'yarn';
  } catch { /* ignore */ }
  try {
    await access(join(cwd, 'yarn.lock'));
    return 'yarn';
  } catch { /* ignore */ }
  return 'npm';
}

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
    docker: Flags.boolean({ char: 'd', description: 'Run in Docker mode (skips starting database servers).' }),
    'no-build': Flags.boolean({ description: 'Skip the build step.' }),
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

    // 3. Start server
    const serverPath: string = detectServerPath(cwd);
    this.log('\nStarting RapidREST server...');
    const serverEnv = { ...process.env, ...dbEnv };
    const server = spawn(process.execPath, [serverPath], {
      cwd,
      stdio: 'inherit',
      env: serverEnv,
    });

    // 4. Forward signals and clean up
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
    cleanup();
  }
}
