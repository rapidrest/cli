import Handlebars from 'handlebars';
import fsExtra from 'fs-extra';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'fs/promises';
import { join, relative, dirname, extname } from 'path';

const BINARY_EXTENSIONS = new Set([
  '.cjs', '.gz', '.png', '.jpg', '.jpeg', '.gif', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip', '.tar',
]);

interface ConditionalFile {
  file: string;
  condition: string;
}

interface TemplateConfig {
  conditionalFiles?: ConditionalFile[];
  // Paths (relative to templateDir) whose files use [[ ]] delimiters instead of
  // Handlebars {{ }} so that Helm Go-template expressions are preserved as-is.
  helmPaths?: string[];
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function resolveContextValue(path: string, context: Record<string, unknown>): unknown {
  return path.split('.').reduce((obj: unknown, key: string) => {
    if (obj !== null && typeof obj === 'object') {
      return (obj as Record<string, unknown>)[key];
    }
    return undefined;
  }, context as unknown);
}

function resolveCondition(condition: string, context: Record<string, unknown>): boolean {
  return Boolean(resolveContextValue(condition, context));
}

function isExcluded(relPath: string, conditionalFiles: ConditionalFile[], context: Record<string, unknown>): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  for (const entry of conditionalFiles) {
    const entryNorm = entry.file.replace(/\\/g, '/');
    if (normalized === entryNorm || normalized.startsWith(entryNorm + '/')) {
      return !resolveCondition(entry.condition, context);
    }
  }
  return false;
}

function isHelmPath(relPath: string, helmPaths: string[]): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  return helmPaths.some(hp => {
    const hpNorm = hp.replace(/\\/g, '/');
    return normalized === hpNorm || normalized.startsWith(hpNorm + '/');
  });
}

// Processes [[ ]] delimited expressions, leaving all {{ }} (Helm Go templates) untouched.
// Supports [[varname]], [[dotted.path]], and [[#if condition]]...[[/if]] blocks (nestable).
function processHelmSafe(content: string, context: Record<string, unknown>): string {
  // Non-greedy match finds innermost [[#if]]...[[/if]] first; iterate until stable
  const ifPattern = /\[\[#if\s+([\w.]+)\]\]([\s\S]*?)\[\[\/if\]\]/g;
  let result = content;
  let prev = '';
  while (result !== prev) {
    prev = result;
    result = result.replace(ifPattern, (_match, condition: string, body: string) => {
      return resolveCondition(condition.trim(), context) ? processHelmSafe(body, context) : '';
    });
  }
  // Substitute [[ varname ]] and [[ dotted.path ]] — all {{ }} pass through untouched
  result = result.replace(/\[\[\s*([\w.]+)\s*\]\]/g, (_match, path: string) => {
    const value = resolveContextValue(path.trim(), context);
    return value !== undefined && value !== null ? String(value) : '';
  });
  return result;
}

export async function processTemplate(
  templateDir: string,
  outputDir: string,
  context: Record<string, unknown>,
  opts?: { force?: boolean },
): Promise<void> {
  let config: TemplateConfig = {};
  const manifestPath = join(templateDir, 'template.config.json');
  if (await fsExtra.pathExists(manifestPath)) {
    const raw = await readFile(manifestPath, 'utf-8');
    config = JSON.parse(raw) as TemplateConfig;
  }
  const conditionalFiles = config.conditionalFiles ?? [];
  const helmPaths = config.helmPaths ?? [];

  const allFiles = await walk(templateDir);

  for (const filePath of allFiles) {
    const relPath = relative(templateDir, filePath);

    if (relPath === 'template.config.json') continue;
    if (isExcluded(relPath, conditionalFiles, context)) continue;

    const useHelm = helmPaths.length > 0 && isHelmPath(relPath, helmPaths);

    // Substitute variables in the output path itself
    const relNorm = relPath.replace(/\\/g, '/');
    const compiledRel = useHelm
      ? relNorm.replace(/\[\[\s*([\w.]+)\s*\]\]/g, (_m, p: string) => {
          const v = resolveContextValue(p.trim(), context);
          return v !== undefined && v !== null ? String(v) : '';
        })
      : Handlebars.compile(relNorm, { noEscape: true })(context);

    const outPath = join(outputDir, compiledRel);

    if (!opts?.force && await fsExtra.pathExists(outPath)) {
      throw new Error(`File already exists: ${outPath}\nUse --force to overwrite.`);
    }

    await mkdir(dirname(outPath), { recursive: true });

    if (BINARY_EXTENSIONS.has(extname(filePath).toLowerCase())) {
      await copyFile(filePath, outPath);
    } else {
      const raw = await readFile(filePath, 'utf-8');
      let content: string;
      if (useHelm) {
        content = processHelmSafe(raw, context);
      } else {
        // Pre-escape ${{ }} sequences (GitHub Actions / GitLab CI syntax) so Handlebars
        // doesn't try to parse them as template expressions.
        const escaped = raw.replace(/\$\{\{/g, '$\\{{');
        // noEscape: true prevents HTML-escaping < > & in TypeScript source
        content = Handlebars.compile(escaped, { noEscape: true })(context);
      }
      await writeFile(outPath, content, 'utf-8');
    }
  }
}
