///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { crc32 } from 'zlib';

vi.unmock('../../src/lib/templateSource.js');
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, request: vi.fn() };
});

import { request } from 'undici';
import {
  createTemplatesHttp,
  extractZip,
  incompatibility,
  readProjectConstraints,
  resolveTemplates,
  TEMPLATE_ENGINE_VERSION,
  templatesCacheRoot,
  type TemplatesHttp,
  type TemplatesManifest,
} from '../../src/lib/templateSource.js';

// A minimal zip writer (stored, uncompressed entries), enough for yauzl to read.
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12); // 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function manifest(version: string, extra: Partial<TemplatesManifest> = {}): TemplatesManifest {
  return { version, engine: `^${TEMPLATE_ENGINE_VERSION}`, targets: { '@rapidrest/core': '6.x' }, ...extra };
}

function templatesZip(m: TemplatesManifest): Buffer {
  return makeZip({ 'templates.json': JSON.stringify(m), 'server/package.json': '{}', 'route/': '' });
}

interface FakeRelease {
  version: string;
  manifest?: TemplatesManifest;
  zip?: Buffer;
  prerelease?: boolean;
  draft?: boolean;
  tag?: string;
  digest?: string;
  noAssets?: boolean;
}

// Fakes GitHub: the releases API and the release asset downloads.
function fakeGitHub(releases: FakeRelease[]) {
  const assets = new Map<string, Buffer>();
  const apiPages: unknown[][] = [[]];
  for (const r of releases) {
    const tag = r.tag ?? `templates-v${r.version}`;
    const zip = r.zip ?? templatesZip(r.manifest ?? manifest(r.version));
    const m = { ...(r.manifest ?? manifest(r.version)), sha256: sha256(zip) };
    assets.set(`https://dl/${tag}/rapidrest-templates.zip`, zip);
    assets.set(`https://dl/${tag}/templates.json`, Buffer.from(JSON.stringify(m)));
    apiPages[0].push({
      tag_name: tag,
      draft: !!r.draft,
      prerelease: !!r.prerelease,
      assets: r.noAssets ? [] : [
        { name: 'rapidrest-templates.zip', browser_download_url: `https://dl/${tag}/rapidrest-templates.zip`, digest: r.digest ?? null },
        { name: 'templates.json', browser_download_url: `https://dl/${tag}/templates.json` },
        { name: 'ignored' },
      ],
    });
  }
  const http = {
    getJson: vi.fn<TemplatesHttp['getJson']>(async (url) => apiPages[Number(new URL(url).searchParams.get('page')) - 1] ?? []),
    download: vi.fn<TemplatesHttp['download']>(async (url, destination) => {
      const data = assets.get(url);
      if (!data) throw new Error(`404 ${url}`);
      await writeFile(destination, data);
    }),
    close: vi.fn(async () => undefined),
  };
  return { http, assets, apiPages };
}

describe('templateSource', () => {
  let tmp: string;
  let cacheRoot: string;
  let cliRoot: string;
  let project: string;
  const warn = vi.fn();
  const log = vi.fn();

  beforeEach(async () => {
    tmp = await mkdtemp(join(os.tmpdir(), 'rr-templates-'));
    cacheRoot = join(tmp, 'cache');
    cliRoot = join(tmp, 'cli'); // no templates/: a published CLI
    project = join(tmp, 'project');
    await mkdir(project, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  const opts = (extra: Record<string, unknown> = {}) => ({ cliRoot, cwd: project, mode: 'new' as const, cacheRoot, log, warn, ...extra });

  describe('templatesCacheRoot', () => {
    it('is ~/.rapidrest/templates, or under $RAPIDREST_HOME', () => {
      const saved = process.env.RAPIDREST_HOME;
      try {
        delete process.env.RAPIDREST_HOME;
        expect(templatesCacheRoot()).toBe(join(os.homedir(), '.rapidrest', 'templates'));
        process.env.RAPIDREST_HOME = '/x';
        expect(templatesCacheRoot()).toBe(join('/x', 'templates'));
      } finally {
        if (saved === undefined) delete process.env.RAPIDREST_HOME;
        else process.env.RAPIDREST_HOME = saved;
      }
    });
  });

  describe('readProjectConstraints', () => {
    it('reads installed @rapidrest versions (falling back to the declared minimum) and the recorded templates version', async () => {
      await writeFile(join(project, 'package.json'), JSON.stringify({
        dependencies: { '@rapidrest/core': '^6.1.0', '@rapidrest/service-core': '^2', lodash: '^4', '@rapidrest/react': 'github:x/y' },
        devDependencies: { '@rapidrest/cli': '^3.0.0' },
        rapidrest: { templates: '1.2.0' },
      }));
      await mkdir(join(project, 'node_modules', '@rapidrest', 'core'), { recursive: true });
      await writeFile(join(project, 'node_modules', '@rapidrest', 'core', 'package.json'), JSON.stringify({ version: '6.3.0' }));

      expect(await readProjectConstraints(project)).toEqual({
        installed: { '@rapidrest/core': '6.3.0', '@rapidrest/service-core': '2.0.0' },
        recorded: '1.2.0',
      });
    });

    it('is empty outside a project, and ignores a recorded version that is not a version', async () => {
      expect(await readProjectConstraints(project)).toEqual({ installed: {}, recorded: undefined });
      await writeFile(join(project, 'package.json'), JSON.stringify({ rapidrest: { templates: 'nope' } }));
      expect((await readProjectConstraints(project)).recorded).toBeUndefined();
    });
  });

  describe('incompatibility', () => {
    const project6 = { installed: { '@rapidrest/core': '6.2.0' }, recorded: '1.0.0' };

    it('rejects templates needing another engine, in every mode', () => {
      expect(incompatibility(manifest('1.0.0', { engine: '^99.0.0' }), 'new')).toContain('needs template engine ^99.0.0');
    });

    it('only applies project constraints in project mode', () => {
      const m = manifest('2.0.0', { targets: { '@rapidrest/core': '7.x' } });
      expect(incompatibility(m, 'new', project6)).toBeUndefined();
      expect(incompatibility(m, 'latest', project6)).toBeUndefined();
      expect(incompatibility(m, 'project')).toBeUndefined();
      expect(incompatibility(m, 'project', project6)).toContain('the project uses templates 1.x');
    });

    it('rejects targets the project does not match, and accepts ones it does', () => {
      expect(incompatibility(manifest('1.5.0', { targets: { '@rapidrest/core': '7.x' } }), 'project', project6))
        .toBe('they target @rapidrest/core 7.x and the project has 6.2.0');
      expect(incompatibility(manifest('1.5.0', { targets: undefined }), 'project', project6)).toBeUndefined();
      expect(incompatibility(manifest('1.5.0'), 'project', project6)).toBeUndefined();
      expect(incompatibility(manifest('3.0.0'), 'project', { installed: {} })).toBeUndefined();
    });
  });

  describe('resolveTemplates', () => {
    it('uses a source checkout\'s own templates/ without touching the network', async () => {
      await mkdir(join(cliRoot, 'templates'), { recursive: true });
      await writeFile(join(cliRoot, 'templates', 'templates.json'), JSON.stringify(manifest('1.4.0')));
      // No http given: the default client is created and closed, but never used.
      expect(await resolveTemplates(opts())).toEqual({ dir: join(cliRoot, 'templates'), version: '1.4.0', source: 'checkout' });
    });

    it('downloads, verifies and caches the newest usable release', async () => {
      const { http } = fakeGitHub([
        { version: '1.2.0', manifest: manifest('1.2.0', { engine: '^99.0.0' }) },
        { version: '1.1.0' },
        { version: '1.0.0' },
        { version: '2.0.0-beta.1', prerelease: true },
        { version: '1.3.0', draft: true },
        { version: '9.9.9', tag: 'v9.9.9' },
        { version: 'x', tag: 'templates-vbad' },
      ]);

      const first = await resolveTemplates(opts({ http, now: () => 1000 }));
      expect(first).toEqual({ dir: join(cacheRoot, '1.1.0'), version: '1.1.0', source: 'release' });
      expect(JSON.parse(await readFile(join(first.dir, 'templates.json'), 'utf-8')).version).toBe('1.1.0');
      expect(await readFile(join(first.dir, 'server', 'package.json'), 'utf-8')).toBe('{}');
      expect(log).toHaveBeenCalledWith('Downloading RapidREST templates 1.1.0...');
      expect(http.close).not.toHaveBeenCalled(); // a caller-supplied client is the caller's to close
      // No temporary files left behind.
      expect((await readdir(cacheRoot)).filter((n) => n.startsWith('.tmp-'))).toEqual([]);

      // Within the hour, the cached release list, manifests and copy are used.
      http.getJson.mockClear();
      http.download.mockClear();
      expect((await resolveTemplates(opts({ http, now: () => 2000 }))).version).toBe('1.1.0');
      expect(http.getJson).not.toHaveBeenCalled();
      expect(http.download).not.toHaveBeenCalled();

      // After it, the list is fetched again.
      await resolveTemplates(opts({ http, now: () => 1000 + 61 * 60 * 1000 }));
      expect(http.getJson).toHaveBeenCalled();
    });

    it('sends GITHUB_TOKEN to the API when set', async () => {
      const { http } = fakeGitHub([{ version: '1.0.0' }]);
      process.env.GITHUB_TOKEN = 'secret';
      try {
        await resolveTemplates(opts({ http }));
      } finally {
        delete process.env.GITHUB_TOKEN;
      }
      expect(http.getJson.mock.calls[0][1].Authorization).toBe('Bearer secret');
    });

    it('reads every page of releases', async () => {
      const { http, apiPages } = fakeGitHub([{ version: '1.0.0' }]);
      const filler = Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.0.${i}` }));
      apiPages.unshift(filler);
      expect((await resolveTemplates(opts({ http }))).version).toBe('1.0.0');
      expect(http.getJson).toHaveBeenCalledTimes(2);
    });

    it('in a project, keeps to the project\'s templates major and framework majors', async () => {
      const { http } = fakeGitHub([
        { version: '2.0.0', manifest: manifest('2.0.0', { targets: { '@rapidrest/core': '7.x' } }) },
        { version: '1.1.0', manifest: manifest('1.1.0', { targets: { '@rapidrest/core': '7.x' } }) },
        { version: '1.0.0' },
      ]);
      await writeFile(join(project, 'package.json'), JSON.stringify({
        dependencies: { '@rapidrest/core': '^6.1.0' }, rapidrest: { templates: '1.0.0' },
      }));
      expect((await resolveTemplates(opts({ http, mode: 'project' }))).version).toBe('1.0.0');
      expect((await resolveTemplates(opts({ http, mode: 'latest' }))).version).toBe('2.0.0');
    });

    it('explains why no release can be used', async () => {
      const { http } = fakeGitHub([{ version: '1.0.0', manifest: manifest('1.0.0', { engine: '^99.0.0' }) }]);
      await expect(resolveTemplates(opts({ http }))).rejects.toThrow(
        /None of the RapidREST templates releases can be used here:\n {2}1\.0\.0: needs template engine \^99\.0\.0/);
      const empty = fakeGitHub([]);
      await expect(resolveTemplates(opts({ http: empty.http, cacheRoot: join(tmp, 'other') })))
        .rejects.toThrow('No RapidREST templates release was found on GitHub (rapidrest/cli, tags templates-v*). Pass --templates');
    });

    it('refuses a download whose SHA-256 does not match, and installs nothing', async () => {
      const { http, assets } = fakeGitHub([{ version: '1.0.0' }]);
      assets.set('https://dl/templates-v1.0.0/rapidrest-templates.zip', templatesZip(manifest('1.0.0', { targets: {} })));
      await expect(resolveTemplates(opts({ http }))).rejects.toThrow('templates 1.0.0 failed verification');
      expect((await readdir(cacheRoot)).filter((n) => n === '1.0.0' || n.startsWith('.tmp-'))).toEqual([]);
    });

    it('also checks the digest GitHub reports for the asset', async () => {
      const { http } = fakeGitHub([{ version: '1.0.0', digest: `sha256:${'0'.repeat(64)}` }]);
      await expect(resolveTemplates(opts({ http }))).rejects.toThrow('failed verification');
      const ok = fakeGitHub([{ version: '1.0.0' }]);
      const zip = templatesZip(manifest('1.0.0'));
      ok.http.download.mockImplementation(async (url, dest) => {
        await writeFile(dest, url.endsWith('.zip') ? zip
          : Buffer.from(JSON.stringify({ ...manifest('1.0.0'), sha256: sha256(zip) })));
      });
      const listing = await ok.http.getJson('https://api/x?page=1', {}) as { assets: { digest?: string }[] }[];
      listing[0].assets[0].digest = `sha256:${sha256(zip).toUpperCase()}`;
      ok.http.getJson.mockResolvedValueOnce(listing);
      expect((await resolveTemplates(opts({ http: ok.http, cacheRoot: join(tmp, 'c2') }))).version).toBe('1.0.0');
    });

    it('rejects a release with an invalid manifest or missing assets', async () => {
      const bad = fakeGitHub([{ version: '1.0.0' }]);
      bad.assets.set('https://dl/templates-v1.0.0/templates.json', Buffer.from(JSON.stringify(manifest('1.0.1'))));
      await expect(resolveTemplates(opts({ http: bad.http }))).rejects.toThrow('has an invalid templates.json');

      const missing = fakeGitHub([{ version: '1.0.0', noAssets: true }]);
      await expect(resolveTemplates(opts({ http: missing.http, cacheRoot: join(tmp, 'c3') })))
        .rejects.toThrow('templates release 1.0.0 has no templates.json asset');
    });

    it('rejects a zip without a valid templates.json', async () => {
      const zip = makeZip({ 'server/x': 'y' });
      const { http } = fakeGitHub([{ version: '1.0.0', zip }]);
      await expect(resolveTemplates(opts({ http }))).rejects.toThrow('the zip has no valid templates.json');
    });

    it('rejects an unexpected API response', async () => {
      const { http } = fakeGitHub([]);
      http.getJson.mockResolvedValueOnce({ message: 'nope' });
      await expect(resolveTemplates(opts({ http }))).rejects.toThrow('unexpected response from the GitHub releases API');
    });

    describe('when GitHub cannot be reached', () => {
      it('uses a stale release list', async () => {
        const { http } = fakeGitHub([{ version: '1.0.0' }]);
        await resolveTemplates(opts({ http, now: () => 0 }));
        http.getJson.mockRejectedValue(new Error('offline'));
        const resolved = await resolveTemplates(opts({ http, now: () => 10 * 60 * 60 * 1000 }));
        expect(resolved.version).toBe('1.0.0');
        expect(warn.mock.calls[0][0]).toMatch(/^Could not list templates releases on GitHub \(offline\); using the list from /);
      });

      it('falls back to the newest usable cached copy', async () => {
        for (const v of ['1.0.0', '1.1.0']) {
          await mkdir(join(cacheRoot, v), { recursive: true });
          await writeFile(join(cacheRoot, v, 'templates.json'), JSON.stringify(manifest(v, v === '1.1.0' ? { engine: '^99.0.0' } : {})));
        }
        await mkdir(join(cacheRoot, 'manifests'), { recursive: true });
        await mkdir(join(cacheRoot, '2.0.0'), { recursive: true }); // no manifest: incomplete
        // eslint-disable-next-line no-throw-literal -- deliberately not an Error
        const http = { getJson: vi.fn(async () => { throw 'offline'; }), download: vi.fn(), close: vi.fn() };
        expect(await resolveTemplates(opts({ http }))).toEqual({ dir: join(cacheRoot, '1.0.0'), version: '1.0.0', source: 'cache' });
        expect(warn).toHaveBeenCalledWith('Could not reach GitHub (offline); using cached templates 1.0.0.');
      });

      it('fails clearly with nothing cached', async () => {
        const http = { getJson: vi.fn(async () => { throw new Error('ENOTFOUND'); }), download: vi.fn(), close: vi.fn() };
        await expect(resolveTemplates(opts({ http }))).rejects.toThrow(
          'Could not download the RapidREST templates (ENOTFOUND), and no usable copy is cached.');
      });
    });

    describe('with an override', () => {
      it('uses a local templates directory', async () => {
        const dir = join(tmp, 'mine');
        await mkdir(dir);
        await writeFile(join(dir, 'templates.json'), JSON.stringify(manifest('5.0.0')));
        expect(await resolveTemplates(opts({ override: dir }))).toEqual({ dir, version: '5.0.0', source: 'override' });
      });

      it('installs a local .zip once, keyed by its content', async () => {
        const zipPath = join(tmp, 'templates.zip');
        await writeFile(zipPath, templatesZip(manifest('5.1.0')));
        const first = await resolveTemplates(opts({ override: 'templates.zip', cwd: tmp }));
        expect(first.version).toBe('5.1.0');
        expect(first.dir.startsWith(join(cacheRoot, 'local-'))).toBe(true);
        expect((await resolveTemplates(opts({ override: zipPath }))).dir).toBe(first.dir);
      });

      it('downloads a release by version, prereleases included', async () => {
        const { http } = fakeGitHub([{ version: '2.0.0-beta.1', prerelease: true }, { version: '1.0.0' }]);
        expect((await resolveTemplates(opts({ http, override: '2.0.0-beta.1' }))).source).toBe('override');
        await expect(resolveTemplates(opts({ http, override: '3.0.0' }))).rejects.toThrow('There is no templates release 3.0.0');
      });

      it('refuses templates needing another engine', async () => {
        const { http } = fakeGitHub([{ version: '1.0.0', manifest: manifest('1.0.0', { engine: '^99.0.0' }) }]);
        await expect(resolveTemplates(opts({ http, override: '1.0.0' }))).rejects.toThrow("Templates 1.0.0 can't be used");
        const dir = join(tmp, 'future');
        await mkdir(dir);
        await writeFile(join(dir, 'templates.json'), JSON.stringify(manifest('9.0.0', { engine: '^99.0.0' })));
        await expect(resolveTemplates(opts({ override: dir }))).rejects.toThrow("Templates 9.0.0 can't be used");
      });

      it('warns, but goes ahead, when the project would not have chosen them', async () => {
        const dir = join(tmp, 'mine');
        await mkdir(dir);
        await writeFile(join(dir, 'templates.json'), JSON.stringify(manifest('2.0.0')));
        await writeFile(join(project, 'package.json'), JSON.stringify({ rapidrest: { templates: '1.0.0' } }));
        expect((await resolveTemplates(opts({ override: dir, mode: 'project' }))).version).toBe('2.0.0');
        expect(warn.mock.calls[0][0]).toContain('Using templates 2.0.0 as requested, although the project uses templates 1.x');
      });

      it('rejects a directory that is not templates, and anything else', async () => {
        await expect(resolveTemplates(opts({ override: project }))).rejects.toThrow("has no valid templates.json, so it isn't a templates directory");
        await expect(resolveTemplates(opts({ override: 'nope' }))).rejects.toThrow('is neither a templates version nor an existing directory or .zip');
      });
    });
  });

  describe('extractZip', () => {
    it('refuses an entry that would land outside the destination', async () => {
      const zipPath = join(tmp, 'evil.zip');
      await writeFile(zipPath, makeZip({ '../evil.txt': 'x' }));
      // yauzl refuses it itself; extractZip's own check is the second line of defence.
      await expect(extractZip(zipPath, join(tmp, 'out'))).rejects.toThrow(/invalid relative path|refusing zip entry/);
    });

    it('rejects a file that is not a zip', async () => {
      const zipPath = join(tmp, 'not.zip');
      await writeFile(zipPath, 'hello');
      await expect(extractZip(zipPath, join(tmp, 'out'))).rejects.toThrow();
    });
  });

  describe('createTemplatesHttp', () => {
    const body = (data: unknown) => ({
      json: async () => data,
      dump: vi.fn(async () => undefined),
      [Symbol.asyncIterator]: async function* () { yield Buffer.from(String(data)); },
    });

    it('gets JSON, downloads to a file and closes its agent', async () => {
      const http = createTemplatesHttp();
      vi.mocked(request).mockResolvedValueOnce({ statusCode: 200, body: body({ a: 1 }) } as never);
      expect(await http.getJson('https://api.github.com/x', { A: 'b' })).toEqual({ a: 1 });
      expect(vi.mocked(request).mock.calls[0][1]).toMatchObject({ headers: { A: 'b' } });

      const { Readable } = await import('stream');
      vi.mocked(request).mockResolvedValueOnce({ statusCode: 200, body: Readable.from([Buffer.from('zipdata')]) } as never);
      const dest = join(tmp, 'file');
      await http.download('https://github.com/x', dest, {});
      expect(await readFile(dest, 'utf-8')).toBe('zipdata');
      await http.close();
      await http.close();
    });

    it('reports an HTTP error, suggesting GITHUB_TOKEN when rate limited', async () => {
      const http = createTemplatesHttp();
      vi.mocked(request).mockResolvedValueOnce({ statusCode: 403, body: body({}) } as never);
      await expect(http.getJson('https://api.github.com/x', {})).rejects.toThrow('HTTP 403 from api.github.com (rate limited? set GITHUB_TOKEN)');
      vi.mocked(request).mockResolvedValueOnce({ statusCode: 500, body: body({}) } as never);
      await expect(http.getJson('https://api.github.com/x', {})).rejects.toThrow(/^HTTP 500 from api.github.com$/);
      await http.close();
    });
  });
});
