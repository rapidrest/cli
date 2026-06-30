import { access, readFile } from 'fs/promises';
import { join } from 'path';

export async function detectReact(cwd: string): Promise<boolean> {
  try {
    await access(join(cwd, 'vite.config.ts'));
    return true;
  } catch {
    return false;
  }
}

// Reads the `author` field from the project's package.json in the given directory.
// Handles both string and { name, email } object forms. Returns undefined on any failure.
export async function readProjectAuthor(cwd: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as { author?: string | { name?: string } };
    if (typeof pkg.author === 'string') return pkg.author || undefined;
    if (typeof pkg.author === 'object' && pkg.author !== null) return pkg.author.name || undefined;
  } catch { /* no package.json or parse error */ }
  return undefined;
}
