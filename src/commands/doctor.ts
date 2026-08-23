///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { Command, Flags } from '@oclif/core';
import { join } from 'path';
import { applyFixes, Finding, runDoctor } from '../lib/doctor.js';

export default class Doctor extends Command {
  static override description = 'Validate an existing RapidREST project against known issues and optionally fix them.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --fix',
    '<%= config.bin %> <%= command.id %> --json',
  ];

  static override flags = {
    fix: Flags.boolean({ description: 'Automatically apply fixes for findings that support it.' }),
    json: Flags.boolean({ description: 'Output findings as JSON instead of a formatted report.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Doctor);
    const cwd = process.cwd();
    const ctx = { cwd, templatesDir: join(this.config.root, 'templates') };

    let findings = await runDoctor(ctx);
    let fixed: Finding[] = [];

    if (flags.fix) {
      const result = await applyFixes(findings);
      fixed = result.fixed;
      if (fixed.length > 0) {
        findings = await runDoctor(ctx);
      }
    }

    if (flags.json) {
      this.log(JSON.stringify({ ok: !findings.some((f) => f.severity === 'error'), findings, fixed: fixed.map((f) => f.id) }, null, 2));
    } else {
      this.printReport(findings, fixed);
    }

    if (findings.some((f) => f.severity === 'error')) {
      this.exit(1);
    }
  }

  private printReport(findings: Finding[], fixed: Finding[]): void {
    if (fixed.length > 0) {
      this.log(`Fixed ${fixed.length} issue(s):`);
      for (const f of fixed) {
        this.log(`  - [${f.id}]${f.file ? ` ${f.file}:` : ''} ${f.message}`);
      }
      this.log('');
    }

    if (findings.length === 0) {
      this.log('No issues found.');
      return;
    }

    const errors = findings.filter((f) => f.severity === 'error');
    const warnings = findings.filter((f) => f.severity === 'warning');

    if (errors.length > 0) {
      this.log(`${errors.length} error(s):`);
      for (const f of errors) {
        this.log(`  - [${f.id}]${f.file ? ` ${f.file}:` : ''} ${f.message}`);
      }
      this.log('');
    }

    if (warnings.length > 0) {
      this.log(`${warnings.length} warning(s):`);
      for (const f of warnings) {
        this.log(`  - [${f.id}]${f.file ? ` ${f.file}:` : ''} ${f.message}`);
      }
      this.log('');
    }

    const fixableRemaining = findings.filter((f) => f.fix);
    if (fixableRemaining.length > 0) {
      this.log(`${fixableRemaining.length} issue(s) can be resolved automatically. Run with --fix to apply them.`);
    }
  }
}
