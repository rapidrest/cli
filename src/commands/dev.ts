import { Command, Flags } from '@oclif/core';
import { join, delimiter } from 'path';
import { spawn } from 'child_process';
import { detectDatabases, startDatabases } from '../lib/db.js';
import { detectReact } from '../lib/project.js';

export default class Dev extends Command {
  static override description = 'Start the RapidREST server in development mode with hot reloading via nodemon + tsx.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --inspect',
  ];

  static override flags = {
    inspect: Flags.boolean({ description: 'Enable Node.js inspector on port 9229 for debugging.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Dev);
    const cwd = process.cwd();

    // 1. Start databases (no build step in dev mode)
    const databases = await detectDatabases(cwd);
    let dbProcesses: ReturnType<typeof spawn>[] = [];
    let dbEnv: Record<string, string> = {};
    try {
      const result = await startDatabases(cwd, databases, (m) => this.log(m), (m) => this.warn(m));
      dbProcesses = result.processes;
      dbEnv = result.env;
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
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
    const tsxExec = flags.inspect
      ? 'tsx --inspect=0.0.0.0:9229 src/server.ts'
      : 'tsx src/server.ts';

    // 4. Start nodemon from the project's node_modules
    this.log('\nStarting RapidREST server in development mode (nodemon + tsx)...');
    const nodemonBin = join(projectBin, `nodemon${ext}`);

    const childProcesses: ReturnType<typeof spawn>[] = [...dbProcesses];

    const server = spawn(
      nodemonBin,
      ['--legacy-watch', '--watch', 'src', '--ext', 'ts,json', '--exec', tsxExec],
      { cwd, stdio: 'inherit', env: serverEnv },
    );
    childProcesses.push(server);

    // 5. Start Vite in watch mode concurrently (if React is configured)
    if (await detectReact(cwd)) {
      this.log('Starting Vite in watch mode...');
      const viteBin = join(projectBin, `vite${ext}`);
      const viteProc = spawn(viteBin, ['build', '--watch'], { cwd, stdio: 'inherit', env: serverEnv });
      childProcesses.push(viteProc);
    }

    // 6. Forward signals and clean up all child processes
    const cleanup = () => {
      for (const p of childProcesses) p.kill();
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    await new Promise<void>((resolve) => { server.once('exit', resolve); });
    cleanup();
  }
}
