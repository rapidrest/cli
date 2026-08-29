///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
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

// Directories this project's eslint config conventionally covers — mirrors the "lint" script
// generated projects ship with (eslint ./src ./test, plus ./apps when React is configured).
// Passed explicitly rather than relying on eslint's own default discovery, since not every
// directory necessarily exists (e.g. a project with no test/ yet).
const LINT_TARGET_DIRS = ['src', 'test', 'app', 'apps'];

export default class Build extends Command {
  static override description = 'Builds the RapidREST server project in the current directory (and its React frontend, if configured).';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --no-lint',
  ];

  static override flags = {
    'no-lint': Flags.boolean({ description: 'Skip linting before building.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Build);
    const cwd = process.cwd();

    try {
      if (!flags['no-lint']) {
        const lintTargets = (
          await Promise.all(LINT_TARGET_DIRS.map(async (dir) => ((await fileExists(join(cwd, dir))) ? dir : undefined)))
        ).filter((dir): dir is string => dir !== undefined);

        this.log('Linting...');
        await runProjectBin(cwd, 'eslint', lintTargets);
      }

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
