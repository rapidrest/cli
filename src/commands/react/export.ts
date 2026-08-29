///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
import { join, delimiter } from 'path';
import spawn from 'cross-spawn';
import { detectDatabases, startDatabases, StartedDatabase } from '../../lib/db.js';
import { detectReact } from '../../lib/project.js';
import { findAvailablePort } from '../../lib/port.js';

export default class ReactExport extends Command {
  static override description = 'Crawl the React app and write a static HTML/CSS/JS site to disk.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --docker',
  ];

  static override flags = {
    docker: Flags.boolean({ char: 'd', description: 'Run in Docker mode (skips starting database servers).' }),
    port: Flags.integer({ char: 'p', description: 'Preferred port to bind the transient export server to. If already in use, the next available port is used instead.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ReactExport);
    const cwd = process.cwd();

    if (!(await detectReact(cwd))) {
      this.error('No React app detected (no vite.config.ts found). Run `rapidrest generate react` first.');
    }

    this.log('\nExporting static site...');

    // 1. Start databases — the export entry boots a real, DI-wired server (same as dev/start),
    // so it has the same database requirements.
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
      this.log('Docker mode enabled.');
    }

    try {
      // 2. Find an available port so the transient export server doesn't collide with an
      // already-running `rapidrest dev`/`rapidrest start`.
      const basePort = flags.port ?? (Number(process.env.port) || 3000);
      const port = await findAvailablePort(basePort);
      if (port !== basePort) {
        if (flags.port && flags.port !== port) {
          throw new Error(`The specified port (${basePort}) is already in use.`);
        } else {
          this.warn(`Port ${basePort} is already in use. Using port ${port} instead.`);
        }
      }

      // 3. Add the project's .bin to PATH so rapidreact can resolve tsx/vite, matching dev/start
      const projectBin = join(cwd, 'node_modules', '.bin');
      const ext = process.platform === 'win32' ? '.cmd' : '';
      const exportEnv = {
        ...process.env,
        ...dbEnv,
        PATH: `${projectBin}${delimiter}${process.env.PATH ?? ''}`,
        port: String(port),
      };

      // 4. Delegate to @rapidrest/react's own CLI, which builds the client bundle then runs
      // the project's src/export.ts entry.
      const rapidreactBin = join(projectBin, `rapidreact${ext}`);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(rapidreactBin, ['export'], {
          cwd,
          stdio: 'inherit',
          env: exportEnv,
        });
        child.once('exit', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`\`rapidreact export\` exited with code ${code}`));
        });
        child.once('error', reject);
      });
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
    } finally {
      for (const db of dbProcesses) {
        this.log(`Stopping database ${db.type}...`);
        await db.server.stop();
      }
    }

    this.log('\nStatic site exported.');
  }
}
