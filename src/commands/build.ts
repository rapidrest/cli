///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command } from '@oclif/core';
import { access, rm } from 'fs/promises';
import { join } from 'path';
import { detectReact, runProjectBin } from '../lib/project.js';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export default class Build extends Command {
  static override description = 'Builds the RapidREST server project in the current directory (and its React frontend, if configured).';

  static override examples = ['<%= config.bin %> <%= command.id %>'];

  async run(): Promise<void> {
    await this.parse(Build);
    const cwd = process.cwd();

    try {
      this.log('Cleaning dist/...');
      await rm(join(cwd, 'dist'), { recursive: true, force: true });

      this.log('Compiling TypeScript...');
      await runProjectBin(cwd, 'tsc', []);

      if (await detectReact(cwd)) {
        if (await fileExists(join(cwd, 'tsconfig.client.json'))) {
          this.log('Compiling client TypeScript (tsconfig.client.json)...');
          await runProjectBin(cwd, 'tsc', ['-p', 'tsconfig.client.json']);
        }

        this.log('Building React frontend...');
        await runProjectBin(cwd, 'vite', ['build']);
      }
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
    }
  }
}
