///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  checkbox: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
}));

vi.mock('../../../src/lib/template.js', () => ({
  processTemplate: vi.fn(),
}));

vi.mock('../../../src/lib/project.js', () => ({
  detectApiRoute: vi.fn(),
  readProjectDatastores: vi.fn(),
  readProjectName: vi.fn(),
  installIfPackageJsonChanged: vi.fn(),
  readPackageJsonRaw: vi.fn(),
}));

vi.mock('../../../src/lib/prompts.js', () => ({
  inputAuthor: vi.fn(),
}));

import { checkbox, input, password, select } from '@inquirer/prompts';
import { processTemplate } from '../../../src/lib/template.js';
import { detectApiRoute, readProjectDatastores, readProjectName } from '../../../src/lib/project.js';
import { inputAuthor } from '../../../src/lib/prompts.js';
import GenerateAuth from '../../../src/commands/generate/auth.js';

const ROOT = process.cwd();

describe('generate auth', () => {
  beforeEach(() => {
    vi.mocked(processTemplate).mockResolvedValue(undefined);
    vi.mocked(inputAuthor).mockResolvedValue('Default Author');
    vi.mocked(readProjectDatastores).mockResolvedValue([]);
    vi.mocked(readProjectName).mockResolvedValue('my-app');
    vi.mocked(detectApiRoute).mockResolvedValue({ apiRoute: false });
    // Default: the auth-method checkbox resolves to just "basic", matching the pre-expansion
    // behavior, so every test that doesn't care about method selection keeps passing unchanged.
    vi.mocked(checkbox).mockResolvedValue(['basic']);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('datastore type resolution', () => {
    it('--datastore-type sql skips the datastore-type select', async () => {
      vi.mocked(select).mockResolvedValueOnce('better-sqlite3'); // sql-type (no existing "sql" datastore)

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).toHaveBeenCalledTimes(1); // sql-type only
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ datastore: 'sql', isSql: true, isSqlite: true, isPostgreSql: false });
    });

    it('rejects an invalid --datastore-type', async () => {
      await expect(
        GenerateAuth.run(['--datastore-type', 'redis', '--output-dir', '/tmp/auth'], ROOT),
      ).rejects.toThrow(/Invalid --datastore-type "redis"/);
    });

    it('prompts for datastore type when --datastore-type is omitted', async () => {
      vi.mocked(select).mockResolvedValueOnce('mongo');

      await GenerateAuth.run(['--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.datastore).toBe('mongo');
      expect(context.isSql).toBe(false);
    });

    it('--datastore-type mongo never prompts for a sql sub-type', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ isSql: false, isPostgreSql: false, isSqlite: false });
    });
  });

  describe('sql sub-type resolution', () => {
    it('--sql-type skips the sql-type select', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'sql', '--sql-type', 'postgres', '--output-dir', '/tmp/auth', '--author', 'A'],
        ROOT,
      );

      expect(vi.mocked(select)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ isPostgreSql: true, isSqlite: false });
    });

    it('rejects an invalid --sql-type', async () => {
      await expect(
        GenerateAuth.run(['--datastore-type', 'sql', '--sql-type', 'oracle', '--output-dir', '/tmp/auth'], ROOT),
      ).rejects.toThrow(/Invalid --sql-type "oracle"/);
    });

    it('derives isPostgreSql/isSqlite from an already-configured "sql" datastore instead of prompting', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'sql', type: 'postgres' }]);

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ isPostgreSql: true, isSqlite: false });
    });

    it('derives isSqlite when the existing "sql" datastore is better-sqlite3', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'sql', type: 'better-sqlite3' }]);

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ isPostgreSql: false, isSqlite: true });
    });

    it('a datastore literally named "mongo" does not satisfy --datastore-type sql', async () => {
      vi.mocked(readProjectDatastores).mockResolvedValue([{ name: 'mongo', type: 'mongodb' }]);
      vi.mocked(select).mockResolvedValueOnce('better-sqlite3');

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).toHaveBeenCalledOnce(); // still prompts for sql-type
    });

    it('prompts for the sql sub-type when creating a new "sql" datastore and --sql-type is omitted', async () => {
      vi.mocked(select).mockResolvedValueOnce('postgres');

      await GenerateAuth.run(['--datastore-type', 'sql', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(select)).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('No "sql" datastore is configured'),
      }));
    });
  });

  describe('context building', () => {
    it('includes author, project_name, and year', async () => {
      vi.mocked(readProjectName).mockResolvedValue('cool-api');

      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'Jane'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ author: 'Jane', project_name: 'cool-api', year: new Date().getFullYear() });
    });

    it('--author skips inputAuthor', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'Flag Author'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Flag Author');
      expect(inputAuthor).not.toHaveBeenCalled();
    });

    it('falls back to inputAuthor when --author is omitted', async () => {
      vi.mocked(inputAuthor).mockResolvedValueOnce('Git Author');

      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.author).toBe('Git Author');
      expect(inputAuthor).toHaveBeenCalledWith(process.cwd());
    });

    it('includes apiRoute/apiVersion detected from the project', async () => {
      vi.mocked(detectApiRoute).mockResolvedValue({ apiRoute: true, apiVersion: '2' });

      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ apiRoute: true, apiVersion: '2' });
    });

    it('sets defaultAccounts: false by default', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.defaultAccounts).toBe(false);
    });

    it('--default-accounts sets defaultAccounts: true', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--default-accounts'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context.defaultAccounts).toBe(true);
    });
  });

  describe('auth method selection', () => {
    it('--method skips the methods checkbox', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'basic', '--method', 'mfa'],
        ROOT,
      );

      expect(vi.mocked(checkbox)).not.toHaveBeenCalled();
      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ methods: expect.objectContaining({ basic: true, mfa: true, otp: false, oidc: false }) });
    });

    it('rejects an invalid --method', async () => {
      await expect(
        GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--method', 'password'], ROOT),
      ).rejects.toThrow(/Invalid --method "password"/);
    });

    it('prompts a checkbox for methods when --method is omitted', async () => {
      vi.mocked(checkbox).mockResolvedValueOnce(['basic', 'totp', 'fido2']);

      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        methods: expect.objectContaining({ basic: true, totp: true, fido2: true, passkey: false, mfa: false, oidc: false }),
      });
    });

    it('sets hasTotpConfig/hasOtplib when mfa is selected even without totp', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'mfa'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ hasTotpConfig: true, hasFido2Config: true, hasOtplib: true, hasWebauthn: true });
    });

    it('sets hasWebauthn when passkey is selected, without pulling in TOTP config', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'passkey'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ hasWebauthn: true, hasTotpConfig: false, hasFido2Config: false, hasOtplib: false });
    });

    it('leaves every method/config flag false for a plain basic-only selection', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'basic'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({
        hasTotpConfig: false,
        hasFido2Config: false,
        hasOtplib: false,
        hasWebauthn: false,
        hasJwksRsa: false,
      });
    });
  });

  describe('OIDC provider sub-flow', () => {
    beforeEach(() => {
      vi.mocked(input).mockResolvedValue('client-id-value');
      vi.mocked(password).mockResolvedValue('client-secret-value');
    });

    it('is skipped entirely when oidc is not among the selected methods', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'basic'],
        ROOT,
      );

      expect(vi.mocked(input)).not.toHaveBeenCalled();
      expect(vi.mocked(processTemplate)).toHaveBeenCalledTimes(1);
    });

    it('--oidc-provider skips the provider checkbox', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'oidc', '--oidc-provider', 'google'],
        ROOT,
      );

      expect(vi.mocked(checkbox)).toHaveBeenCalledTimes(0); // methods came from --method too
      expect(vi.mocked(processTemplate)).toHaveBeenCalledTimes(2); // main template + one provider
    });

    it('rejects an invalid --oidc-provider', async () => {
      await expect(
        GenerateAuth.run(
          ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--method', 'oidc', '--oidc-provider', 'github'],
          ROOT,
        ),
      ).rejects.toThrow(/Invalid --oidc-provider "github"/);
    });

    it('generates one processTemplate call per selected provider, using the oidc-provider template dir', async () => {
      await GenerateAuth.run(
        [
          '--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A',
          '--method', 'oidc', '--oidc-provider', 'google', '--oidc-provider', 'apple',
        ],
        ROOT,
      );

      expect(vi.mocked(processTemplate)).toHaveBeenCalledTimes(3);
      const [providerTemplateDir1] = vi.mocked(processTemplate).mock.calls[1];
      const [providerTemplateDir2] = vi.mocked(processTemplate).mock.calls[2];
      expect(providerTemplateDir1).toContain(join('templates', 'auth', 'oidc-provider'));
      expect(providerTemplateDir2).toContain(join('templates', 'auth', 'oidc-provider'));
    });

    it('populates Google preset data (openid, known endpoints, jwksURI) into the provider context', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'oidc', '--oidc-provider', 'google'],
        ROOT,
      );

      const [, , providerContext] = vi.mocked(processTemplate).mock.calls[1];
      expect(providerContext).toMatchObject({
        providerKey: 'google',
        providerClassName: 'Google',
        name: 'oidc_google',
        protocol: 'openid',
        authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenURL: 'https://oauth2.googleapis.com/token',
        issuer: 'https://accounts.google.com',
        jwksURI: 'https://www.googleapis.com/oauth2/v3/certs',
        scope: ['openid', 'email', 'profile'],
        clientID: 'client-id-value',
        clientSecret: 'client-secret-value',
      });
    });

    it('populates Facebook preset data with protocol oauth2 and no jwksURI/issuer', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'oidc', '--oidc-provider', 'facebook'],
        ROOT,
      );

      const [, , providerContext] = vi.mocked(processTemplate).mock.calls[1];
      expect(providerContext).toMatchObject({ providerKey: 'facebook', protocol: 'oauth2' });
      expect(providerContext.jwksURI).toBeUndefined();
      expect(providerContext.issuer).toBeUndefined();
    });

    it('sets hasJwksRsa true when any selected provider uses openid', async () => {
      await GenerateAuth.run(
        [
          '--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A',
          '--method', 'oidc', '--oidc-provider', 'facebook', '--oidc-provider', 'google',
        ],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ hasJwksRsa: true });
    });

    it('leaves hasJwksRsa false when every selected provider is oauth2-only', async () => {
      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'oidc', '--oidc-provider', 'facebook'],
        ROOT,
      );

      const [, , context] = vi.mocked(processTemplate).mock.calls[0];
      expect(context).toMatchObject({ hasJwksRsa: false });
    });

    it('prompts additional fields (authorizationURL, tokenURL, protocol, scope) for a custom provider', async () => {
      vi.mocked(input)
        .mockResolvedValueOnce('client-id-value') // Client ID
        .mockResolvedValueOnce('https://example.com/authorize') // authorizationURL
        .mockResolvedValueOnce('https://example.com/token') // tokenURL
        .mockResolvedValueOnce('https://example.com/userinfo') // profileURL
        .mockResolvedValueOnce('custom-scope-1,custom-scope-2'); // scope
      vi.mocked(select).mockResolvedValueOnce('oauth2'); // protocol

      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'oidc', '--oidc-provider', 'custom'],
        ROOT,
      );

      const [, , providerContext] = vi.mocked(processTemplate).mock.calls[1];
      expect(providerContext).toMatchObject({
        providerKey: 'custom',
        providerClassName: 'Custom',
        name: 'oidc_custom',
        protocol: 'oauth2',
        authorizationURL: 'https://example.com/authorize',
        tokenURL: 'https://example.com/token',
        profileURL: 'https://example.com/userinfo',
        scope: ['custom-scope-1', 'custom-scope-2'],
      });
    });

    it('prompts for issuer/jwksURI on a custom provider using openid', async () => {
      vi.mocked(input)
        .mockResolvedValueOnce('client-id-value') // Client ID
        .mockResolvedValueOnce('https://example.com/authorize') // authorizationURL
        .mockResolvedValueOnce('https://example.com/token') // tokenURL
        .mockResolvedValueOnce('') // profileURL
        .mockResolvedValueOnce('https://example.com') // issuer
        .mockResolvedValueOnce('https://example.com/.well-known/jwks.json') // jwksURI
        .mockResolvedValueOnce('openid email'); // scope
      vi.mocked(select).mockResolvedValueOnce('openid'); // protocol

      await GenerateAuth.run(
        ['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--method', 'oidc', '--oidc-provider', 'custom'],
        ROOT,
      );

      const [, , providerContext] = vi.mocked(processTemplate).mock.calls[1];
      expect(providerContext).toMatchObject({
        protocol: 'openid',
        issuer: 'https://example.com',
        jwksURI: 'https://example.com/.well-known/jwks.json',
        profileURL: undefined,
      });
    });

    it('prompts for the provider checkbox when --oidc-provider is omitted', async () => {
      vi.mocked(checkbox)
        .mockResolvedValueOnce(['oidc']) // methods checkbox
        .mockResolvedValueOnce(['microsoft']); // oidc-provider checkbox

      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      expect(vi.mocked(checkbox)).toHaveBeenCalledTimes(2);
      const [, , providerContext] = vi.mocked(processTemplate).mock.calls[1];
      expect(providerContext).toMatchObject({ providerKey: 'microsoft', name: 'oidc_microsoft' });
    });
  });

  describe('output and template options', () => {
    it('defaults the output directory to process.cwd()', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--author', 'A'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe(process.cwd());
    });

    it('uses --output-dir when provided', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/custom/path', '--author', 'A'], ROOT);

      const [, outputDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(outputDir).toBe('/custom/path');
    });

    it('points processTemplate at the auth template directory', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [templateDir] = vi.mocked(processTemplate).mock.calls[0];
      expect(templateDir).toContain(join('templates', 'auth'));
    });

    it('passes force: true and the project cwd as projectDir when --force is set', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A', '--force'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: true, projectDir: process.cwd() });
    });

    it('passes force: undefined when --force is not set', async () => {
      await GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT);

      const [, , , opts] = vi.mocked(processTemplate).mock.calls[0];
      expect(opts).toMatchObject({ force: undefined });
    });
  });

  describe('error handling', () => {
    it('propagates an error thrown by processTemplate', async () => {
      vi.mocked(processTemplate).mockRejectedValue(new Error('template boom'));

      await expect(
        GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT),
      ).rejects.toThrow('template boom');
    });

    it('falls back to String(err) when processTemplate rejects with a non-Error value', async () => {
      vi.mocked(processTemplate).mockRejectedValue('non-error-boom');

      await expect(
        GenerateAuth.run(['--datastore-type', 'mongo', '--output-dir', '/tmp/auth', '--author', 'A'], ROOT),
      ).rejects.toThrow('non-error-boom');
    });
  });
});
