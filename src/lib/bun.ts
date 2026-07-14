import { execFile } from 'child_process';
import { createWriteStream, existsSync } from 'fs';
import { chmod, mkdir, readdir, rm } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { gte, rcompare, valid, coerce } from 'semver';
import yauzl from 'yauzl';

const execFileAsync = promisify(execFile);

// RapidREST relies on Bun APIs that were only stabilized in 1.4.0 — earlier
// versions are known to be incompatible.
export const MIN_BUN_VERSION = '1.4.0';

// GitHub's `/releases/latest/download/<asset>` redirects to the actual latest
// release's asset, so we don't need to know the version up front.
const BUN_LATEST_DOWNLOAD_URL = 'https://github.com/oven-sh/bun/releases/latest/download';

function bunBinaryName(): string {
  return process.platform === 'win32' ? 'bun.exe' : 'bun';
}

function bunCacheRoot(): string {
  return join(homedir(), '.rapidrest', 'bun');
}

function bunCacheDir(version: string): string {
  return join(bunCacheRoot(), version);
}

// Maps the running platform/arch to the corresponding asset name published in
// Bun's GitHub releases (e.g. `bun-darwin-aarch64`, `bun-windows-x64`).
export function bunAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const archName = arch === 'arm64' ? 'aarch64' : 'x64';
  if (platform === 'darwin') return `bun-darwin-${archName}`;
  if (platform === 'linux') return `bun-linux-${archName}`;
  if (platform === 'win32') {
    if (archName !== 'x64') throw new Error(`Unsupported architecture for Bun on Windows: ${arch}`);
    return 'bun-windows-x64';
  }
  throw new Error(`Unsupported platform for Bun download: ${platform}`);
}

// Returns the version reported by `<bunPath> --version`, or undefined if the
// executable can't be found or run.
export async function getBunVersion(bunPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(bunPath, ['--version']);
    return coerce(stdout.trim())?.version;
  } catch {
    return undefined;
  }
}

// Resolves the "latest release" redirect one hop (without following it all the way
// to the signed, version-less CDN URL) so we can learn which version it points to.
async function resolveLatestBunDownload(assetName: string): Promise<{ url: string; version: string }> {
  const latestUrl = `${BUN_LATEST_DOWNLOAD_URL}/${assetName}.zip`;
  const probe = await fetch(latestUrl, { redirect: 'manual' });
  await probe.body?.cancel();
  const location = probe.headers.get('location');
  const match = location?.match(/\/bun-v([\d.]+)\//);
  if (!location || !match) {
    throw new Error(`Could not determine the latest Bun release from ${latestUrl} (HTTP ${probe.status})`);
  }
  return { url: new URL(location, latestUrl).href, version: match[1] };
}

// Extracts the `bun`/`bun.exe` binary from the downloaded archive into `destDir`,
// ignoring any other files in the zip (debug symbols, license files, etc.).
async function extractBunBinary(zipPath: string, destDir: string): Promise<string> {
  const binaryName = bunBinaryName();
  const destPath = join(destDir, binaryName);

  const zipfile = await yauzl.openPromise(zipPath);
  let found = false;
  for await (const entry of zipfile.eachEntry()) {
    if (entry.fileName.endsWith('/') || basename(entry.fileName) !== binaryName) continue;
    const readStream = await zipfile.openReadStreamPromise(entry);
    await pipeline(readStream, createWriteStream(destPath));
    found = true;
    break;
  }
  if (!found) {
    throw new Error(`Could not find '${binaryName}' inside the downloaded Bun archive.`);
  }

  if (process.platform !== 'win32') {
    await chmod(destPath, 0o755);
  }
  return destPath;
}

// Looks for a previously downloaded Bun in the cache that already satisfies
// `minVersion`, returning the newest match (if any) without touching the network.
async function findCachedBun(minVersion: string): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = await readdir(bunCacheRoot());
  } catch {
    return undefined;
  }

  const versions = entries.filter((name) => valid(name) && gte(name, minVersion)).sort(rcompare);
  for (const version of versions) {
    const binPath = join(bunCacheDir(version), bunBinaryName());
    if (existsSync(binPath)) return binPath;
  }
  return undefined;
}

async function downloadBun(minVersion: string, log: (msg: string) => void): Promise<string> {
  const assetName = bunAssetName();
  log('Looking up the latest Bun release...');
  const { url, version } = await resolveLatestBunDownload(assetName);

  if (!gte(version, minVersion)) {
    throw new Error(
      `The latest available Bun release (v${version}) is still below the required v${minVersion}. ` +
      `RapidREST cannot run under Bun until a compatible version is released — see https://bun.sh for updates.`,
    );
  }

  const destDir = bunCacheDir(version);
  const zipPath = join(destDir, `${assetName}.zip`);

  log(`Downloading Bun v${version} (${assetName})...`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Bun from ${url} (HTTP ${response.status})`);
  }

  await mkdir(destDir, { recursive: true });
  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(zipPath));

  try {
    const binaryPath = await extractBunBinary(zipPath, destDir);
    log(`Bun v${version} installed at ${binaryPath}`);
    return binaryPath;
  } finally {
    await rm(zipPath, { force: true });
  }
}

// Ensures a Bun executable satisfying MIN_BUN_VERSION is available, downloading one
// if necessary, and returns the path (or bare command) to invoke.
//
// Prefers the system-installed `bun` on PATH when it already meets the minimum
// version. Otherwise reuses a previously downloaded compatible version from the
// per-user cache (~/.rapidrest/bun/<version>/), or downloads the latest release.
export async function resolveBunExecutable(
  log: (msg: string) => void,
  warn: (msg: string) => void,
): Promise<string> {
  const systemVersion = await getBunVersion('bun');
  if (systemVersion && gte(systemVersion, MIN_BUN_VERSION)) {
    return 'bun';
  }

  if (systemVersion) {
    warn(`Installed Bun version ${systemVersion} is below the required v${MIN_BUN_VERSION}. Looking for a compatible version...`);
  } else {
    log(`Bun was not found on this system. Looking for a compatible version to download...`);
  }

  const cachedPath = await findCachedBun(MIN_BUN_VERSION);
  if (cachedPath) return cachedPath;

  return downloadBun(MIN_BUN_VERSION, log);
}
