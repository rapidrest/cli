import { Command, Flags } from '@oclif/core';
import { join, delimiter } from 'path';
import { spawn } from 'child_process';
import { detectDatabases, startDatabases, StartedDatabase } from '../lib/db.js';
import { detectReact } from '../lib/project.js';

export default class Dev extends Command {
  static override description = 'Start the RapidREST server in development mode with hot reloading via nodemon + tsx.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --inspect',
  ];

  static override flags = {
    docker: Flags.boolean({ char: 'd', description: 'Run in Docker mode (skips starting database servers).' }),
    inspect: Flags.boolean({ description: 'Enable Node.js inspector on port 9229 for debugging.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Dev);
    const cwd = process.cwd();

    this.log('\nStarting RapidREST server in development mode...');

    // 1. Start databases (no build step in dev mode)
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

    // 2. Add project's .bin to PATH so nodemon can resolve tsx (and vite)
    const projectBin = join(cwd, 'node_modules', '.bin');
    const ext = process.platform === 'win32' ? '.cmd' : '';
    const serverEnv = {
      ...process.env,
      ...dbEnv,
      PATH: `${projectBin}${delimiter}${process.env.PATH ?? ''}`,
    };

    // 3. Build the tsx exec string — with optional inspector
    const tsxExec = join(projectBin, `tsx${ext}`);
    const tsxArgs = ['--watch', 'src/server.ts'];
    if (flags.inspect) {
      tsxArgs.unshift('--inspect=0.0.0.0:9229');
    }

    const childProcesses: ReturnType<typeof spawn>[] = [];

    const server = spawn(
      tsxExec,
      tsxArgs,
      { cwd, stdio: 'inherit', env: serverEnv, shell: process.platform === 'win32' },
    );
    childProcesses.push(server);

    // 5. Start Vite in watch mode concurrently (if React is configured)
    if (await detectReact(cwd)) {
      this.log('Starting Vite in watch mode...');
      const viteBin = join(projectBin, `vite${ext}`);
      const viteProc = spawn(viteBin, ['build', '--watch'], { cwd, stdio: 'inherit', env: serverEnv, shell: process.platform === 'win32' });
      childProcesses.push(viteProc);
    }

    // 6. Forward signals and clean up all child processes
    const cleanup = async () => {
      for (const p of childProcesses) {
        p.kill();
      }
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
