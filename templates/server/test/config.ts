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
            {{else if features.postgresql}}
            type: "postgresql",
            host: "localhost",
            port: 5432,
            database: "acls",
            username: "postgres",
            password: "postgres",
            synchronize: true,
            {{else if features.sqlite}}
            type: "sqlite",
            database: "./data/acls.db",
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
        ]
    },
    session: {
        secret: "SESSION_SECRET",
    },
});

export default conf;
