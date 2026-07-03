import { checkbox, confirm, input, select, Separator } from '@inquirer/prompts';
import { Args, Command, Flags } from '@oclif/core';
import { join } from 'path';
import { processTemplate } from '../../lib/template.js';
import { inputAuthor } from '../../lib/prompts.js';
import GenerateDocker from './docker.js';
import GenerateHelm from './k8s.js';
import GenerateReact from './react.js';

export default class GenerateServer extends Command {
  static override args = {
    name: Args.string({ description: 'Name of the new server project (also used as the output directory name).', required: true }),
  };

  static override description = 'Generate a new RapidREST server project from the built-in template.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> my-api',
    '<%= config.bin %> <%= command.id %> my-api --output-dir ~/projects/my-api',
  ];

  static override flags = {
    force: Flags.boolean({ description: 'Overwrite existing files.' }),
    'output-dir': Flags.string({ description: 'Directory to write the generated project into. Defaults to ./<name>.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(GenerateServer);
    const outputDir = flags['output-dir'] ?? join(process.cwd(), args.name);

    this.log(`Generating RapidREST server project: "${args.name}"...\n`);

    const description = await input({
      message: 'Enter a short project description:',
      required: true,
    });

    const author = flags.author ?? (await inputAuthor());

    const pkgMgr = await select<'npm' | 'yarn'>({
      message: 'Select a package manager:',
      choices: [
        { name: 'yarn', value: 'yarn' },
        { name: 'npm', value: 'npm' },
      ],
    });

    const dbFeatures = await checkbox<string>({
      message: 'Select the databases you will be using:',
      choices: [
        { name: 'MongoDB', value: 'mongodb', checked: true },
        { name: 'PostgreSQL', value: 'postgresql' },
        { name: 'Redis (cache)', value: 'redis', checked: true, description: 'Required for cache support.' },
        { name: 'SQLite', value: 'sqlite' },
      ],
    });

    const otherFeatures = await checkbox<string>({
      message: 'Select additional features:',
      choices: [
        new Separator('-- Frontend --'),
        { name: 'React', value: 'react' },
        new Separator('-- Deployment --'),
        { name: 'Docker', value: 'docker', checked: true },
        { name: 'Kubernetes (Helm)', value: 'k8s' },
        // new Separator('-- Desktop --'),
        // { name: 'Electron', value: 'electron' },
      ],
    });

    const scmChoice = await select<string>({
      message: 'Select your Source Control Manager (SCM):',
      choices: [
        { name: 'GitHub', value: 'github' },
        { name: 'GitLab', value: 'gitlab' },
        { name: 'Git (local)', value: 'git' },
        { name: 'Perforce (Helix)', value: 'p4' },
        { name: 'Subversion', value: 'svn' },
        { name: '(none)', value: '' },
      ],
    });

    const allFeatures = [...dbFeatures, ...otherFeatures];

    const context: Record<string, unknown> = {
      project_name: args.name,
      description,
      repository: `${scmChoice}/${args.name}`,
      author,
      year: new Date().getFullYear(),
      pkgMgr: {
        npm: pkgMgr === 'npm',
        yarn: pkgMgr === 'yarn',
      },
      features: {
        mongodb: allFeatures.includes('mongodb'),
        postgresql: allFeatures.includes('postgresql'),
        redis: allFeatures.includes('redis'),
        sqlite: allFeatures.includes('sqlite'),
        docker: allFeatures.includes('docker'),
        react: allFeatures.includes('react'),
        electron: allFeatures.includes('electron'),
        k8s: allFeatures.includes('k8s'),
        hasDatabase: allFeatures.includes('mongodb') || allFeatures.includes('postgresql') || allFeatures.includes('sqlite'),
      },
      scm: {
        git: scmChoice === 'git' || scmChoice === 'github' || scmChoice === 'gitlab',
        github: scmChoice === 'github',
        gitlab: scmChoice === 'gitlab',
        p4: scmChoice === 'p4',
        svn: scmChoice === 'svn',
      },
    };

    const templateDir = join(this.config.root, 'templates', 'server');

    try {
      await processTemplate(templateDir, outputDir, context, { force: flags.force });

      if (allFeatures.includes('docker')) {
        this.log('\nAdding Docker support...');
        await GenerateDocker.run([
          '--output-dir', outputDir,
          ...(flags.force ? ['--force'] : []),
        ], this.config.root);
      }

      if (allFeatures.includes('k8s')) {
        this.log('\nAdding Kubernetes (Helm) support...');
        await GenerateHelm.run([
          '--output-dir', outputDir,
          ...(flags.force ? ['--force'] : []),
        ], this.config.root);
      }

      if (allFeatures.includes('react')) {
        this.log('\nAdding React support...');
        await GenerateReact.run([
          'app',
          '--output-dir', outputDir,
          ...(flags.force ? ['--force'] : []),
        ], this.config.root);
      }

      this.log(`\nProject "${args.name}" generated at: ${outputDir}`);
      this.log(`\nNext steps:`);
      this.log(`  cd ${args.name}`);
      this.log(`  ${pkgMgr} install`);
      this.log(`  ${pkgMgr} run build`);
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
