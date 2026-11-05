///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { checkbox, input, password, select } from '@inquirer/prompts';
import { Command, Flags } from '@oclif/core';
import { join } from 'path';
import { renderTemplate, templatesFlag, useTemplates } from '../../lib/templateCommand.js';
import { detectApiRoute, installIfPackageJsonChanged, readPackageJsonRaw, readProjectDatastores, readProjectName } from '../../lib/project.js';
import { inputAuthor } from '../../lib/prompts.js';

const DATASTORE_TYPES = ['sql', 'mongo'];
const SQL_TYPES = ['postgres', 'better-sqlite3'];
const AUTH_METHODS = ['basic', 'otp', 'totp', 'passkey', 'fido2', 'mfa', 'oidc'];
const OIDC_PROVIDERS = ['google', 'apple', 'facebook', 'microsoft', 'custom'];

interface OIDCPreset {
  label: string;
  protocol: 'openid' | 'oauth2';
  authorizationURL: string;
  tokenURL: string;
  profileURL?: string;
  issuer?: string;
  jwksURI?: string;
  scope: string[];
  comment?: string;
}

// Well-known, stable endpoints for popular third-party OIDC/OAuth providers. Verify these against
// the provider's current `.well-known/openid-configuration` before deploying — they can change.
const OIDC_PRESETS: Record<string, OIDCPreset> = {
  google: {
    label: 'Google',
    protocol: 'openid',
    authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenURL: 'https://oauth2.googleapis.com/token',
    issuer: 'https://accounts.google.com',
    jwksURI: 'https://www.googleapis.com/oauth2/v3/certs',
    scope: ['openid', 'email', 'profile'],
  },
  apple: {
    label: 'Apple',
    protocol: 'openid',
    authorizationURL: 'https://appleid.apple.com/auth/authorize',
    tokenURL: 'https://appleid.apple.com/auth/token',
    issuer: 'https://appleid.apple.com',
    jwksURI: 'https://appleid.apple.com/auth/keys',
    scope: ['openid', 'email', 'name'],
    comment: 'Apple requires the client secret to be a signed JWT (private key + team ID + key ID, ' +
      'regenerated periodically), not a static string like the other providers. Replace the value ' +
      'entered below with your own generation logic before deploying.',
  },
  facebook: {
    label: 'Facebook',
    protocol: 'oauth2',
    authorizationURL: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenURL: 'https://graph.facebook.com/v19.0/oauth/access_token',
    profileURL: 'https://graph.facebook.com/me?fields=id,name,email,first_name,last_name,picture',
    scope: ['email', 'public_profile'],
    comment: 'Facebook does not return an id_token/JWKS in the standard flow. The default profile ' +
      'mapping may need adjustment (providerConfig.profileMap) to match the shape returned by the ' +
      'fields requested above.',
  },
  microsoft: {
    label: 'Microsoft',
    protocol: 'openid',
    authorizationURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    issuer: 'https://login.microsoftonline.com/common/v2.0',
    jwksURI: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    scope: ['openid', 'email', 'profile', 'User.Read'],
    comment: 'Uses the multi-tenant "common" endpoint. Single-tenant apps should replace "common" ' +
      'with their tenant ID in authorizationURL/tokenURL/issuer/jwksURI.',
  },
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface OIDCProviderContext {
  providerKey: string;
  providerClassName: string;
  name: string;
  envKey: string;
  label: string;
  protocol: string;
  authorizationURL: string;
  tokenURL: string;
  redirectURI: string;
  profileURL?: string;
  issuer?: string;
  jwksURI?: string;
  scope: string[];
  clientID: string;
  clientSecret: string;
  comment?: string;
}

/** What the flags already settle about the OIDC providers; anything left undefined is prompted for. */
export interface OIDCFlagAnswers {
  /** provider key -> client ID, from --oidc-client-id. */
  clientIDs: Record<string, string>;
  /** --oidc-credentials-from-env: leave credentials not given by flags empty instead of prompting. */
  credentialsFromEnv: boolean;
  custom: {
    authorizationURL?: string;
    tokenURL?: string;
    profileURL?: string;
    protocol?: 'openid' | 'oauth2';
    issuer?: string;
    jwksURI?: string;
    scope?: string[];
  };
}

/** Parses the repeatable `--oidc-client-id <provider>=<id>` flag values. */
export function parseOIDCClientIDs(values: string[] | undefined, error: (msg: string) => never): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values ?? []) {
    const eq = value.indexOf('=');
    const provider = eq > 0 ? value.slice(0, eq) : '';
    if (!OIDC_PROVIDERS.includes(provider) || eq === value.length - 1) {
      error(`Invalid --oidc-client-id "${value}". Expected <provider>=<client id>, with provider one of: ${OIDC_PROVIDERS.join(', ')}`);
    }
    result[provider] = value.slice(eq + 1);
  }
  return result;
}

async function promptOIDCProvider(providerKey: string, answers: OIDCFlagAnswers): Promise<OIDCProviderContext> {
  const preset = OIDC_PRESETS[providerKey];
  const label = preset?.label ?? 'Custom';

  const clientID = answers.clientIDs[providerKey]
    ?? (answers.credentialsFromEnv ? '' : await input({ message: `${label} OIDC Client ID:`, required: true }));
  const clientSecret = answers.credentialsFromEnv
    ? ''
    : await password({ message: `${label} OIDC Client Secret:`, mask: '*' });

  const name = `oidc_${providerKey}`;
  const envKey = name.toUpperCase();
  const redirectURI = `http://localhost:3000/auth/oidc/${providerKey}/callback`;

  if (providerKey === 'custom') {
    const flagged = answers.custom;
    // Once any --oidc-custom-* flag is given, the optional settings it leaves out take their
    // defaults rather than being prompted for, so a fully flagged run never stops at a prompt.
    const anyFlagged = Object.values(flagged).some((v) => v !== undefined);
    const optional = async (value: string | undefined, message: string): Promise<string> =>
      value ?? (anyFlagged ? '' : await input({ message, required: false }));

    const authorizationURL = flagged.authorizationURL ?? await input({ message: 'Authorization URL:', required: true });
    const tokenURL = flagged.tokenURL ?? await input({ message: 'Token URL:', required: true });
    const profileURL = await optional(flagged.profileURL, 'Profile URL (leave blank if using only an id_token):');
    const protocol = flagged.protocol ?? (anyFlagged ? 'openid' : await select<'openid' | 'oauth2'>({
      message: 'Protocol:',
      choices: [
        { name: 'OpenID Connect', value: 'openid' },
        { name: 'OAuth 2.0', value: 'oauth2' },
      ],
    }));
    const issuer = protocol === 'openid' ? await optional(flagged.issuer, 'Issuer (expected "iss" claim):') : '';
    const jwksURI = protocol === 'openid' ? await optional(flagged.jwksURI, 'JWKS URI:') : '';
    const scopeInput = flagged.scope?.join(',') ?? (anyFlagged
      ? 'openid email profile'
      : await input({ message: 'Scopes (comma-separated):', default: 'openid email profile', required: false }));

    return {
      providerKey,
      providerClassName: 'Custom',
      name,
      envKey,
      label,
      protocol,
      authorizationURL,
      tokenURL,
      redirectURI,
      profileURL: profileURL || undefined,
      issuer: issuer || undefined,
      jwksURI: jwksURI || undefined,
      // Scopes are space-separated in OAuth (RFC 6749 3.3) and the prompt asks for comma-separated,
      // so either separator, as in the 'openid email profile' default, yields one entry per scope.
      scope: scopeInput.split(/[\s,]+/).filter(Boolean),
      clientID,
      clientSecret,
    };
  }

  return {
    providerKey,
    providerClassName: capitalize(providerKey),
    name,
    envKey,
    label: preset.label,
    protocol: preset.protocol,
    authorizationURL: preset.authorizationURL,
    tokenURL: preset.tokenURL,
    redirectURI,
    profileURL: preset.profileURL,
    issuer: preset.issuer,
    jwksURI: preset.jwksURI,
    scope: preset.scope,
    clientID,
    clientSecret,
    comment: preset.comment,
  };
}

export default class GenerateAuth extends Command {
  static override args = {};

  static override description = [
    'Add login/session scaffolding to the current project, backed by @rapidrest/auth: self-service',
    'registration, admin user management, and one or more of: HTTP Basic, OTP, TOTP, Passkey,',
    'FIDO2, MFA, and OAuth 2.0/OpenID Connect (with per-provider presets for Google, Apple,',
    'Facebook, and Microsoft, or a custom provider).',
    '',
    'Out of scope for this command (all real, working parts of @rapidrest/auth, just not scaffolded',
    'here): session refresh, auth-method discovery, and direct Profile/Account/',
    'Alias management routes. Add those by hand, following the same pattern as the routes this',
    'command generates.',
  ].join('\n');

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --datastore-type sql --sql-type better-sqlite3',
    '<%= config.bin %> <%= command.id %> --datastore-type mongo --default-accounts',
    '<%= config.bin %> <%= command.id %> --method basic --method mfa --method oidc --oidc-provider google --oidc-provider apple',
    '<%= config.bin %> <%= command.id %> --method oidc --oidc-provider google --oidc-client-id google=1234.apps.googleusercontent.com --oidc-credentials-from-env',
  ];

  static override flags = {
    force: Flags.boolean({ char: 'f', description: 'Overwrite existing files.' }),
    templates: templatesFlag,
    author: Flags.string({ char: 'a', description: 'The author to attribute the resulting source code to.' }),
    'output-dir': Flags.string({ description: 'Directory to write the generated files into. Defaults to the current working directory.' }),
    'datastore-type': Flags.string({ description: `Which datastore backs authentication data. One of: ${DATASTORE_TYPES.join(', ')}` }),
    'sql-type': Flags.string({ description: `When --datastore-type sql and no "sql" datastore exists yet, which SQL database to create it as. One of: ${SQL_TYPES.join(', ')}` }),
    'default-accounts': Flags.boolean({ description: 'Also provision a default admin account the first time the server boots against an empty user table.' }),
    method: Flags.string({ multiple: true, description: `Which authentication method(s) to enable. One of: ${AUTH_METHODS.join(', ')}. Repeatable.` }),
    'oidc-provider': Flags.string({ multiple: true, description: `When "oidc" is among --method, which third-party OIDC/OAuth provider(s) to configure. One of: ${OIDC_PROVIDERS.join(', ')}. Repeatable.` }),
    'oidc-client-id': Flags.string({ multiple: true, description: 'An OIDC provider\'s client ID, as <provider>=<client id> (e.g. google=1234.apps.googleusercontent.com). Repeatable.' }),
    'oidc-credentials-from-env': Flags.boolean({ description: 'Don\'t prompt for OIDC client secrets (or client IDs not given by --oidc-client-id): leave them empty in config.ts, to be supplied through the environment (e.g. AUTH__OIDC_GOOGLE__CLIENTSECRET).' }),
    'oidc-custom-authorization-url': Flags.string({ description: 'With --oidc-provider custom, the provider\'s authorization URL.' }),
    'oidc-custom-token-url': Flags.string({ description: 'With --oidc-provider custom, the provider\'s token URL.' }),
    'oidc-custom-profile-url': Flags.string({ description: 'With --oidc-provider custom, the provider\'s profile URL (omit when using only an id_token).' }),
    'oidc-custom-protocol': Flags.string({ options: ['openid', 'oauth2'], description: 'With --oidc-provider custom, the protocol: openid (OpenID Connect, the default) or oauth2.' }),
    'oidc-custom-issuer': Flags.string({ description: 'With --oidc-provider custom and openid, the expected "iss" claim.' }),
    'oidc-custom-jwks-uri': Flags.string({ description: 'With --oidc-provider custom and openid, the JWKS URI.' }),
    'oidc-custom-scope': Flags.string({ multiple: true, description: 'With --oidc-provider custom, a scope to request (default: openid, email, profile). Repeatable.' }),
    'no-install': Flags.boolean({ description: 'Skip running the package manager install after generating.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(GenerateAuth);
    const cwd = process.cwd();
    const outputDir = flags['output-dir'] ?? cwd;
    const packageJsonBefore = await readPackageJsonRaw(cwd);

    this.log('Generating authentication scaffolding...\n');

    if (flags['datastore-type'] !== undefined && !DATASTORE_TYPES.includes(flags['datastore-type'])) {
      this.error(`Invalid --datastore-type "${flags['datastore-type']}". Must be one of: ${DATASTORE_TYPES.join(', ')}`);
    }
    const datastoreType = flags['datastore-type'] ?? await select<string>({
      message: 'Which datastore should back authentication data?',
      choices: [
        { name: 'SQL (PostgreSQL / SQLite)', value: 'sql' },
        { name: 'MongoDB', value: 'mongo' },
      ],
    });
    const isSql = datastoreType === 'sql';

    const configured = await readProjectDatastores(cwd);
    const existing = configured.find((d) => d.name === datastoreType);

    let isPostgreSql = false;
    let isSqlite = false;
    if (isSql) {
      if (existing) {
        isPostgreSql = existing.type === 'postgres';
        isSqlite = existing.type === 'better-sqlite3';
      } else {
        if (flags['sql-type'] !== undefined && !SQL_TYPES.includes(flags['sql-type'])) {
          this.error(`Invalid --sql-type "${flags['sql-type']}". Must be one of: ${SQL_TYPES.join(', ')}`);
        }
        const sqlType = flags['sql-type'] ?? await select<string>({
          message: 'No "sql" datastore is configured yet — select the SQL database type to create it as:',
          choices: [
            { name: 'PostgreSQL', value: 'postgres' },
            { name: 'SQLite', value: 'better-sqlite3' },
          ],
        });
        isPostgreSql = sqlType === 'postgres';
        isSqlite = sqlType === 'better-sqlite3';
      }
    }

    const methodFlag = flags.method;
    let methods: string[];
    if (methodFlag && methodFlag.length > 0) {
      const invalid = methodFlag.filter((m) => !AUTH_METHODS.includes(m));
      if (invalid.length > 0) {
        this.error(`Invalid --method "${invalid.join(', ')}". Must be one of: ${AUTH_METHODS.join(', ')}`);
      }
      methods = methodFlag;
    } else {
      methods = await checkbox<string>({
        message: 'Select the authentication method(s) to enable:',
        choices: [
          { name: 'HTTP Basic (username/password)', value: 'basic', checked: true },
          { name: 'OTP (one-time password via email/SMS)', value: 'otp' },
          { name: 'TOTP (authenticator app, e.g. Google Authenticator)', value: 'totp' },
          { name: 'Passkey (WebAuthn, synced credentials)', value: 'passkey' },
          { name: 'FIDO2 (WebAuthn, hardware security key)', value: 'fido2' },
          { name: 'MFA (password + a second factor)', value: 'mfa' },
          { name: 'OAuth 2.0 / OpenID Connect (third-party providers)', value: 'oidc' },
        ],
      });
    }

    const hasBasic = methods.includes('basic');
    const hasOtp = methods.includes('otp');
    const hasTotp = methods.includes('totp');
    const hasPasskey = methods.includes('passkey');
    const hasFido2 = methods.includes('fido2');
    const hasMfa = methods.includes('mfa');
    const hasOidc = methods.includes('oidc');

    const oidcProviderContexts: OIDCProviderContext[] = [];
    if (hasOidc) {
      const oidcProviderFlag = flags['oidc-provider'];
      let oidcProviderKeys: string[];
      if (oidcProviderFlag && oidcProviderFlag.length > 0) {
        const invalid = oidcProviderFlag.filter((p) => !OIDC_PROVIDERS.includes(p));
        if (invalid.length > 0) {
          this.error(`Invalid --oidc-provider "${invalid.join(', ')}". Must be one of: ${OIDC_PROVIDERS.join(', ')}`);
        }
        oidcProviderKeys = oidcProviderFlag;
      } else {
        oidcProviderKeys = await checkbox<string>({
          message: 'Select the third-party OIDC/OAuth provider(s) to configure:',
          choices: [
            { name: 'Google', value: 'google', checked: true },
            { name: 'Apple', value: 'apple' },
            { name: 'Facebook', value: 'facebook' },
            { name: 'Microsoft', value: 'microsoft' },
            { name: 'Custom', value: 'custom' },
          ],
        });
      }

      const oidcAnswers: OIDCFlagAnswers = {
        clientIDs: parseOIDCClientIDs(flags['oidc-client-id'], (msg) => this.error(msg)),
        credentialsFromEnv: flags['oidc-credentials-from-env'] ?? false,
        custom: {
          authorizationURL: flags['oidc-custom-authorization-url'],
          tokenURL: flags['oidc-custom-token-url'],
          profileURL: flags['oidc-custom-profile-url'],
          protocol: flags['oidc-custom-protocol'] as 'openid' | 'oauth2' | undefined,
          issuer: flags['oidc-custom-issuer'],
          jwksURI: flags['oidc-custom-jwks-uri'],
          scope: flags['oidc-custom-scope'],
        },
      };
      for (const providerKey of oidcProviderKeys) {
        oidcProviderContexts.push(await promptOIDCProvider(providerKey, oidcAnswers));
      }
    }

    const author = flags.author ?? (await inputAuthor(cwd));
    const apiInfo = await detectApiRoute(cwd);

    const hasTotpConfig = hasTotp || hasMfa;
    const hasFido2Config = hasFido2 || hasMfa;
    const hasOtplib = hasOtp || hasTotp || hasMfa;
    const hasWebauthn = hasPasskey || hasFido2 || hasMfa;
    const hasJwksRsa = oidcProviderContexts.some((p) => p.protocol === 'openid');

    const context: Record<string, unknown> = {
      author,
      year: new Date().getFullYear(),
      project_name: await readProjectName(cwd),
      // Always set (even when the datastore already exists) — the ts-block-insert patch is
      // idempotent per its own idempotencyKey, so reusing an existing "sql"/"mongo" datastore is a
      // safe no-op rather than something this command needs to pre-check itself.
      datastore: datastoreType,
      isSql,
      isPostgreSql,
      isSqlite,
      apiRoute: apiInfo.apiRoute,
      apiVersion: apiInfo.apiVersion,
      defaultAccounts: flags['default-accounts'] ?? false,
      methods: {
        basic: hasBasic,
        otp: hasOtp,
        totp: hasTotp,
        passkey: hasPasskey,
        fido2: hasFido2,
        mfa: hasMfa,
        oidc: hasOidc,
      },
      hasTotpConfig,
      hasFido2Config,
      hasOtplib,
      hasWebauthn,
      hasJwksRsa,
    };

    const templates = await useTemplates(this, cwd, 'project', flags.templates);

    const templateDir = join(templates.dir, 'auth');
    const oidcProviderTemplateDir = join(templates.dir, 'auth', 'oidc-provider');

    try {
      await renderTemplate(this, templateDir, outputDir, context, { force: flags.force, projectDir: cwd });

      for (const providerContext of oidcProviderContexts) {
        this.log(`\nAdding OIDC provider: ${providerContext.label}...`);
        await renderTemplate(this, oidcProviderTemplateDir, outputDir, { ...context, ...providerContext }, { force: flags.force, projectDir: cwd });
      }

      this.log(`\nAuthentication scaffolding generated at: ${outputDir}`);

      if (!flags['no-install']) {
        await installIfPackageJsonChanged(cwd, packageJsonBefore, (m) => this.log(m), (m) => this.warn(m));
      } else {
        this.log(`\n@rapidrest/auth and argon2 were added to package.json — install dependencies before building.`);
      }
    } catch (err) {
      this.error(err instanceof Error ? err.message : String(err));
    }
  }
}
