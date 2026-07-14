import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, execFile: vi.fn() };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, existsSync: vi.fn(), createWriteStream: vi.fn() };
});

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return { ...actual, mkdir: vi.fn(), chmod: vi.fn(), rm: vi.fn(), readdir: vi.fn() };
});

vi.mock('stream', async (importOriginal) => {
  const actual = await importOriginal<typeof import('stream')>();
  return { ...actual, Readable: { ...actual.Readable, fromWeb: vi.fn(() => ({})) } };
});

vi.mock('stream/promises', () => ({ pipeline: vi.fn().mockResolvedValue(undefined) }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => '/fake-home' };
});

vi.mock('yauzl', () => ({ default: { openPromise: vi.fn() } }));

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, chmod, rm, readdir } from 'fs/promises';
import yauzl from 'yauzl';
import {
  MIN_BUN_VERSION,
  bunAssetName,
  getBunVersion,
  resolveBunExecutable,
} from '../../src/lib/bun.js';

const CACHE_ROOT = join('/fake-home', '.rapidrest', 'bun');

function mockExecFile(response: { stdout: string } | Error): void {
  vi.mocked(execFile).mockImplementation(((_file: string, _args: readonly string[], callback: any) => {
    if (response instanceof Error) callback(response);
    else callback(null, { stdout: response.stdout, stderr: '' });
    return {} as any;
  }) as any);
}

function makeZipFile(entryNames: string[]) {
  return {
    eachEntry: async function* () {
      for (const fileName of entryNames) yield { fileName };
    },
    openReadStreamPromise: vi.fn().mockResolvedValue({}),
  };
}

// Mocks the two fetch() calls made by a successful download: the manual-redirect
// probe against the "latest" URL, followed by the real asset download.
function mockSuccessfulFetchSequence(version: string): void {
  vi.mocked(fetch)
    .mockResolvedValueOnce({
      status: 302,
      headers: { get: (name: string) => (name === 'location' ? `https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-x64.zip` : null) },
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    } as any)
    .mockResolvedValueOnce({ ok: true, status: 200, body: {} } as any);
}

async function withPlatform<T>(platform: string, arch: string, fn: () => Promise<T>): Promise<T> {
  const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const archDesc = Object.getOwnPropertyDescriptor(process, 'arch')!;
  Object.defineProperty(process, 'platform', { value: platform });
  Object.defineProperty(process, 'arch', { value: arch });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', platformDesc);
    Object.defineProperty(process, 'arch', archDesc);
  }
}

describe('bunAssetName', () => {
  it('maps darwin/x64 to bun-darwin-x64', () => {
    expect(bunAssetName('darwin', 'x64')).toBe('bun-darwin-x64');
  });

  it('maps darwin/arm64 to bun-darwin-aarch64', () => {
    expect(bunAssetName('darwin', 'arm64')).toBe('bun-darwin-aarch64');
  });

  it('maps linux/x64 to bun-linux-x64', () => {
    expect(bunAssetName('linux', 'x64')).toBe('bun-linux-x64');
  });

  it('maps linux/arm64 to bun-linux-aarch64', () => {
    expect(bunAssetName('linux', 'arm64')).toBe('bun-linux-aarch64');
  });

  it('maps win32/x64 to bun-windows-x64', () => {
    expect(bunAssetName('win32', 'x64')).toBe('bun-windows-x64');
  });

  it('throws for win32/arm64 (unsupported)', () => {
    expect(() => bunAssetName('win32', 'arm64')).toThrow('Unsupported architecture for Bun on Windows');
  });

  it('throws for an unsupported platform', () => {
    expect(() => bunAssetName('sunos', 'x64')).toThrow('Unsupported platform for Bun download: sunos');
  });
});

describe('getBunVersion', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the parsed version when the command succeeds', async () => {
    mockExecFile({ stdout: '1.4.2\n' });
    expect(await getBunVersion('bun')).toBe('1.4.2');
  });

  it('coerces extraneous output into a valid version', async () => {
    mockExecFile({ stdout: 'bun 1.4.0' });
    expect(await getBunVersion('bun')).toBe('1.4.0');
  });

  it('returns undefined when the command fails (e.g. not installed)', async () => {
    mockExecFile(new Error('ENOENT'));
    expect(await getBunVersion('bun')).toBeUndefined();
  });
});

describe('resolveBunExecutable', () => {
  const log = vi.fn();
  const warn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdir).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns "bun" when the system version already satisfies the minimum', async () => {
    mockExecFile({ stdout: `${MIN_BUN_VERSION}\n` });

    const result = await resolveBunExecutable(log, warn);

    expect(result).toBe('bun');
    expect(fetch).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns "bun" when the system version exceeds the minimum', async () => {
    mockExecFile({ stdout: '2.0.0\n' });

    const result = await resolveBunExecutable(log, warn);

    expect(result).toBe('bun');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('warns and looks elsewhere when the system version is below the minimum', async () => {
    mockExecFile({ stdout: '1.0.0\n' });

    await resolveBunExecutable(log, warn).catch(() => undefined);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1.0.0'));
  });

  it('logs when bun is not installed at all', async () => {
    mockExecFile(new Error('ENOENT'));

    await resolveBunExecutable(log, warn).catch(() => undefined);

    expect(log).toHaveBeenCalledWith(expect.stringContaining('was not found'));
  });

  it('reuses the highest cached version satisfying the minimum, without downloading', async () => {
    mockExecFile(new Error('ENOENT'));
    vi.mocked(readdir).mockResolvedValue(['1.3.9', MIN_BUN_VERSION, '1.5.2', 'garbage'] as any);
    vi.mocked(existsSync).mockReturnValue(true);

    const result = await withPlatform('linux', 'x64', () => resolveBunExecutable(log, warn));

    expect(result).toBe(join(CACHE_ROOT, '1.5.2', 'bun'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores cached versions below the minimum', async () => {
    mockExecFile(new Error('ENOENT'));
    vi.mocked(readdir).mockResolvedValue(['1.0.0', '1.2.0'] as any);
    vi.mocked(existsSync).mockReturnValue(true);
    mockSuccessfulFetchSequence(MIN_BUN_VERSION);
    vi.mocked(yauzl.openPromise).mockResolvedValue(makeZipFile(['bun-linux-x64/bun']) as any);

    await withPlatform('linux', 'x64', () => resolveBunExecutable(log, warn));

    expect(fetch).toHaveBeenCalled();
  });

  it('falls through to the next-highest cached version when the highest one is missing its binary', async () => {
    mockExecFile(new Error('ENOENT'));
    vi.mocked(readdir).mockResolvedValue(['1.4.0', '1.5.0'] as any);
    vi.mocked(existsSync).mockImplementation((p) => !String(p).includes('1.5.0'));

    const result = await withPlatform('linux', 'x64', () => resolveBunExecutable(log, warn));

    expect(result).toBe(join(CACHE_ROOT, '1.4.0', 'bun'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads and extracts the latest release when nothing is cached', async () => {
    mockExecFile(new Error('ENOENT'));
    mockSuccessfulFetchSequence('1.4.5');
    vi.mocked(yauzl.openPromise).mockResolvedValue(makeZipFile(['bun-linux-x64/bun']) as any);

    const result = await withPlatform('linux', 'x64', () => resolveBunExecutable(log, warn));

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64.zip',
      { redirect: 'manual' },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://github.com/oven-sh/bun/releases/download/bun-v1.4.5/bun-linux-x64.zip',
    );
    expect(mkdir).toHaveBeenCalledWith(join(CACHE_ROOT, '1.4.5'), { recursive: true });
    expect(chmod).toHaveBeenCalledWith(join(CACHE_ROOT, '1.4.5', 'bun'), 0o755);
    expect(rm).toHaveBeenCalled();
    expect(result).toBe(join(CACHE_ROOT, '1.4.5', 'bun'));
  });

  it('does not chmod on win32', async () => {
    mockExecFile(new Error('ENOENT'));
    mockSuccessfulFetchSequence('1.4.5');
    vi.mocked(yauzl.openPromise).mockResolvedValue(makeZipFile(['bun-windows-x64/bun.exe']) as any);

    const result = await withPlatform('win32', 'x64', () => resolveBunExecutable(log, warn));

    expect(chmod).not.toHaveBeenCalled();
    expect(result).toBe(join(CACHE_ROOT, '1.4.5', 'bun.exe'));
  });

  it('throws when the latest release is still below the minimum version', async () => {
    mockExecFile(new Error('ENOENT'));
    vi.mocked(fetch).mockResolvedValue({
      status: 302,
      headers: { get: (name: string) => (name === 'location' ? 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip' : null) },
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    } as any);

    await expect(
      withPlatform('linux', 'x64', () => resolveBunExecutable(log, warn)),
    ).rejects.toThrow(`The latest available Bun release (v1.3.14) is still below the required v${MIN_BUN_VERSION}`);

    expect(fetch).toHaveBeenCalledTimes(1); // never attempts the real download
  });

  it('throws when the "latest" redirect cannot be resolved', async () => {
    mockExecFile(new Error('ENOENT'));
    vi.mocked(fetch).mockResolvedValue({
      status: 404,
      headers: { get: () => null },
      body: { cancel: vi.fn().mockResolvedValue(undefined) },
    } as any);

    await expect(
      withPlatform('linux', 'x64', () => resolveBunExecutable(log, warn)),
    ).rejects.toThrow('Could not determine the latest Bun release');
  });

  it('throws a descriptive error when the download request fails', async () => {
    mockExecFile(new Error('ENOENT'));
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        status: 302,
        headers: { get: (name: string) => (name === 'location' ? `https://github.com/oven-sh/bun/releases/download/bun-v${MIN_BUN_VERSION}/bun-linux-x64.zip` : null) },
        body: { cancel: vi.fn().mockResolvedValue(undefined) },
      } as any)
      .mockResolvedValueOnce({ ok: false, status: 404, body: null } as any);

    await expect(
      withPlatform('linux', 'x64', () => resolveBunExecutable(log, warn)),
    ).rejects.toThrow('Failed to download Bun');
  });

  it('throws a descriptive error when the archive does not contain the expected binary', async () => {
    mockExecFile(new Error('ENOENT'));
    mockSuccessfulFetchSequence(MIN_BUN_VERSION);
    vi.mocked(yauzl.openPromise).mockResolvedValue(makeZipFile(['README.md', 'bun-linux-x64/bun.pdb']) as any);

    await expect(
      withPlatform('linux', 'x64', () => resolveBunExecutable(log, warn)),
    ).rejects.toThrow("Could not find 'bun' inside the downloaded Bun archive");
  });
});
