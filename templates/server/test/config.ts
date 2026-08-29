///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { createRequire } from "module";
import nconf from "nconf";

const _require = createRequire(import.meta.url);
const packageInfo = _require("../package.json");

const conf = nconf
    .argv()
    .env({
        separator: "__",
        parseValues: true,
    });

conf.defaults({
    service_name: packageInfo.name,
    version: packageInfo.version,
    cookieSecret: "COOKIE_SECRET",
    cors: {
        origin: ["http://localhost:3000"],
    },
    datastores: {
        {{#if features.hasDatabase}}
        acl: {
            {{#if features.mongodb}}
            type: "mongodb",
            host: "localhost",
            port: 9999,
            database: "acls",
            synchronize: true,
            {{else if features.hasSqlDatastore}}
            // Tests always run the SQL datastore(s) against better-sqlite3 rather than a real
            // Postgres server, even when the project's own config.ts targets postgres — TypeORM's
            // driver abstraction means the same entities/queries work against either, and an
            // in-memory sqlite database needs no external server and gets a clean slate every run.
            // `host` is a harmless placeholder — better-sqlite3 never uses it, but
            // ConnectionManager.buildConnectionUri() requires one (unless `url` is set) to build
            // a connection string.
            type: "better-sqlite3",
            host: "localhost",
            database: ":memory:",
            synchronize: true,
            {{/if}}
        },
        {{/if}}
        {{#if features.mongodb}}
        mongo: {
            type: "mongodb",
            host: "localhost",
            port: 9999,
            database: "{{project_name}}",
        },
        {{/if}}
        {{#if features.postgresql}}
        postgres: {
            type: "better-sqlite3",
            host: "localhost",
            database: ":memory:",
            synchronize: true,
        },
        {{/if}}
        {{#if features.sqlite}}
        sqlite: {
            type: "better-sqlite3",
            host: "localhost",
            database: ":memory:",
            synchronize: true,
        },
        {{/if}}
    },
    // Specifies the role names that are considered to be trusted with administrative privileges.
    trusted_roles: ["admin"],
    // Settings pertaining to the signing and verification of authentication tokens
    auth: {
        // The default PassportJS authentication strategy to use
        strategy: "auth.JWTStrategy",
        // The password to be used when signing and verifying authentication tokens
        secret: "MyPasswordIsSecure",
        options: {
            // "algorithm": "HS256",
            expiresIn: "1 hour",
            audience: "company.local",
            issuer: "api.company.local",
        },
    },
    metrics: {
        authRequired: false,
    },
    // TODO Remove 'scripts'
    scripts: {
        ignore: [
            /server\..*/,
            /config\..*/
        ]
    },
    class_loader: {
        ignore: [
            /server\..*/,
            /config\..*/
        ],
    },
    session: {
        secret: "SESSION_SECRET",
    },
});

export default conf;
