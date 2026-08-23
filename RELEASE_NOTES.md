# Release Notes

## Unreleased

**New: `generate auth`**

* Added `rapidrest generate auth`, an opt-in command that scaffolds login/session support backed
  by the now-stable `@rapidrest/auth@1.0.0`: self-service registration, HTTP Basic login, logout,
  and admin user management, as thin subclasses of the library's own ready-made model/route base
  classes (no hand-written `User` model). Supports both SQL and MongoDB, and an opt-in
  `--default-accounts` flag that provisions a default admin account on first boot. Reintroduces,
  as an opt-in command rather than baked into every scaffold, the auth scaffolding that was removed
  earlier when `BasicStrategy` moved out of `@rapidrest/service-core` into the (then-prerelease)
  `@rapidrest/auth` package
* `detectApiRoute` (recovering a project's `/api` prefix convention from `HelloRoute.ts`) moved
  from `upgrade.ts` to the shared `project.ts`, now used by both `upgrade` and `generate auth`
* `generate auth` now lets you select which authentication method(s) to scaffold via a new
  `--method` flag (repeatable) or checkbox prompt: `basic`, `otp`, `totp`, `passkey`, `fido2`,
  `mfa`, and `oidc` — each conditionally generating its matching route file and, for
  `totp`/`fido2`/`mfa`, an `auth.totp`/`auth.fido2` config block. A new, always-generated
  `SecretRoute.ts` handles password changes and TOTP/Passkey/FIDO2 enrollment regardless of which
  methods are selected. Selecting `oidc` prompts for one or more third-party providers (Google,
  Apple, Facebook, Microsoft, or a custom provider), each with its own preset endpoints, Client
  ID/Secret prompt, generated route file, and `auth.oidc_<provider>` config block — selecting more
  than one provider is fully supported. `otplib`, `@simplewebauthn/server`, and `jwks-rsa` are added
  to `package.json` only when a selected method/provider actually needs them
* Fixed a real bug in `@rapidrest/auth` this surfaced, in the library itself rather than worked
  around here: `BaseAuthOIDCRoute` hardcoded its registered strategy name to the literal `"oauth"`,
  so wiring up more than one OIDC/OAuth provider in the same app silently collided — whichever
  route was loaded last won for all of them. Fixed in `@rapidrest/auth@1.1.0` via a new overridable
  `strategyName` field; `generate auth`'s generated OIDC provider routes each set their own and now
  require `@rapidrest/auth@^1.1.0`

**New: non-interactive `generate server`**

* `rapidrest generate server` can now be run fully non-interactively: a new flag per prompt
  (`--description`, `--pkg-manager`, `--db`, `--route`/`--react`/`--docker`/`--k8s`, `--api-route`/
  `--api-version`, `--scm`) plus a new `--answers <file>` JSON-profile flag for reuse across
  projects. Any flag (or its `--answers` equivalent) skips that one prompt; omitting both keeps the
  existing interactive behavior exactly as before. Flags always take precedence over the same field
  in `--answers`; either takes precedence over the prompt
* Fixed a real bug this surfaced: `generate server` invokes `generate default-route` internally for
  any default routes selected, but when the API prefix was declined (or, now, resolved to "off" via
  a flag/`--answers` with routes still selected), it omitted `default-route`'s own `--api` flag
  entirely rather than expressing "off" — which is indistinguishable from "not specified" to that
  command, so it fell through to its *own* "Is this an API route?" prompt. Harmless but redundant
  in interactive use; a silent hang for a fully non-interactive `generate server` run. Fixed by
  giving `generate default-route` a proper `--api-route`/`--no-api-route` boolean (existing
  `--api <version>` usage keeps working, now implying `--api-route`) that `generate server` always
  passes explicitly, and that also happens to be the reliable way to request "on, no version"
  non-interactively (a bare `--api` with no value throws `Flag --api expects a value` in oclif —
  pre-existing, not fixed here, just no longer needed for this case)

**New: `generate model` property definitions**

* `rapidrest generate model` can now scaffold real, typed data properties instead of just the
  hardcoded `name: string` identifier field. Add them via repeatable `--property name:type` flags
  (`string`/`number`/`boolean`/`string[]`/`number[]`/`Date`, or a free-text custom type; append `?`
  to the type for an optional property), or interactively via a new "add a property?" prompt loop
  when no `--property` flags are given. Generated properties match `@rapidrest/service-core`'s own
  example model conventions (`@Column()` + `@Description(...)`, `@Nullable` for optional
  properties) and get matching constructor assignments. The existing `name` field is untouched —
  it's still the model's `@Identifier`, load-bearing for REST route lookups

**New: `rapidrest doctor`**

* Added a new `rapidrest doctor [--fix] [--json]` command that validates an existing generated
  project against a set of known issues — a datastore `type` using this CLI's own feature-flag name
  instead of TypeORM's driver literal, a `better-sqlite3` datastore missing its placeholder `host`,
  a missing `vitest.config.ts`, `typeorm`/`redis` not resolvable for type-checking, an
  `eslint-plugin-import` + `eslint@10` conflict, the old boolean-flag `ACLRecord` shape, and a
  `JWTUser` object literal carrying an unsupported `name` field. Mechanically-safe findings can be
  auto-fixed with `--fix`; the rest are reported for manual follow-up. Useful for validating projects
  scaffolded a while ago that may have drifted from what the currently installed `@rapidrest/*`
  libraries expect

**New: `rapidrest upgrade`**

* Added a new `rapidrest upgrade [--write] [--json]` command that refreshes an already-generated
  project's generator-owned boilerplate files and dependency version pins against the currently
  installed templates — the complement to `doctor`'s fixed known-bad-pattern checks. Only ever
  touches a file that already exists in the project (never creates one, so opt-in features like
  Docker/Kubernetes/default-routes a project never added are left alone); `src/config.ts`/
  `test/config.ts` are never touched (patch-mutated and user-edited, out of scope — see `doctor`);
  `package.json` is never overwritten wholesale, only known dependency version pins are updated or
  added, with the project's own added dependencies and `scripts` left untouched
* Fixed `templates/server/README.md` using `{{project_description}}`, a Handlebars variable
  `generate server` never actually sets (the context key is `description`) — every project this
  CLI has ever scaffolded has shipped with an empty description line in its README. Found via
  `upgrade`'s own end-to-end verification; `rapidrest upgrade --write` will backfill it for
  existing projects

**Dependencies**

* Upgraded `@rapidrest/core`, `@rapidrest/service-core`, and `@rapidrest/react` to their latest releases
  (`5.1.0`, `1.3.0`, `1.0.0`) and aligned every other `templates/server` dependency (`eslint`,
  `@typescript-eslint/*`, `pg`, `better-sqlite3`, `mongodb`, `redis`, `typeorm`, etc.) to match the versions
  those libraries themselves use, including in the `generate model`-time patches under `templates/model/patches`
* Removed `eslint-plugin-import` from the generated server template — no version of it supports `eslint@10`
  (its peer range caps at `^9`), which made `npm install` fail outright for any new project; it enforced no
  active rules in the template's own config, so it was dropped rather than migrated to a replacement

**Removed built-in auth scaffolding**

* Removed the generated server template's built-in `User` model, `UserRoute`, and `AuthRoute` (HTTP Basic
  login/logout) — `BasicStrategy` moved out of `@rapidrest/service-core` into the separate, still-prerelease
  `@rapidrest/auth` package, and pulling in a prerelease dependency for scaffolding wasn't worth it

**Access control**

* Migrated every generated `@Protect(...)` ACL block from `@rapidrest/service-core`'s old boolean-flag
  `ACLRecord` shape (`create`/`read`/`update`/`delete`/`special`/`full`) to the current `actions: ACLAction[]`
  array shape
* Fixed `templates/route`'s route-level `@Protect(acl, true)` call passing a second argument that
  `RouteDecorators.Protect` (unlike `ModelDecorators.Protect`) doesn't accept

**Redis**

* Replaced `ioredis`/`ioredis-mock` with `redis` (node-redis) throughout the generated server and its tests,
  matching `@rapidrest/core`/`@rapidrest/service-core`'s v4+ migration off `ioredis`

**SQL datastores (PostgreSQL / SQLite)**

* Fixed `config.ts` declaring datastore types as `"postgresql"`/`"sqlite"` — TypeORM's actual driver literals
  are `"postgres"`/`"better-sqlite3"`. Every generated postgresql/sqlite project failed to connect outside of
  `rapidrest dev` (which happened to paper over it via env-var injection); a real deployment or `rapidrest
  start` hit it directly. Threaded the fix through everywhere the value was read back: `db.ts`'s feature
  detection, `generate docker`/`generate k8s`'s `hasPostgres` checks, `generate model`'s `isPostgreSql`/
  `isSqlite` flags, and `docker-compose.yml`
* Added the `host` placeholder `ConnectionManager.buildConnectionUri()` requires unconditionally for
  `better-sqlite3` datastores (which don't otherwise use one)
* Replaced TypeORM's removed `Connection` class with `isSqlDataSource()` in generated route tests
* Added SQL test support: generated tests now run postgresql/sqlite-backed models against an in-memory
  `better-sqlite3` database instead of requiring a real Postgres server, since TypeORM's driver abstraction
  makes the same entities/queries work against either
* Fixed `repo.findOne({uid})`/`repo.count({uid})` in generated route tests using MongoDB's bare-filter style
  unconditionally — TypeORM's SQL repositories need `{ where: { uid } }`
* Fixed a duplicate-`typeorm`-dependency risk when a project selects both the postgresql and sqlite features
  (`dbFeatures` is a multi-select) by gating it on a new combined `features.hasSqlDatastore` flag instead of
  two separate conditional blocks
* `templates/model/patches/package-postgresql.json`/`package-sqlite.json` (the `generate model`-time
  dependency patches, a separate path from `generate server`) were still pinned to `typeorm@^0.3.20`, were
  missing `pg` entirely, and had `better-sqlite3` misplaced under `devDependencies` at a stale version — fixed
  to match the server template
* `@rapidrest/core`/`@rapidrest/service-core`'s type declarations reference `typeorm` and `redis`
  unconditionally regardless of which datastore features are selected, so `tsc` failed for any project
  missing either. Both are now always present — as a real dependency when the matching feature is enabled,
  otherwise as a devDependency just for type-checking

**React**

* Fixed `templates/react/src/export.ts` only ever configuring one app's `runStaticExport()` call — since it
  was regenerated unconditionally on every `generate react` call, adding a second app to a multi-app project
  silently discarded the first app's export config. Moved its generation out of the Handlebars template and
  into `generate react` itself (mirroring how `vite.config.ts`/`tsconfig.client.json` already handle
  cross-app state Handlebars can't see), so it now emits the multi-app `apps: [...]` form when more than one
  app is configured

**Test/build infrastructure**

* Added a missing `vitest.config.ts` to the generated server template — without it, vitest's default
  transform couldn't handle the decorator syntax every model/route template uses, so every generated
  project's test suite failed before this fix. Mirrors `@rapidrest/service-core`/`@rapidrest/react`'s own
  config (SWC decorator plugin, the `service-core/test` subpath alias), with coverage thresholds left at 0
  since a fresh scaffold shouldn't be held to 100%
* Fixed `templates/route`'s own `template.config.json` and `patches/` living one directory too deep
  (`src/routes/` instead of the template root) — `processTemplate` never found them, so `generate route
  --protect`'s RBAC-enable patch silently never applied, and the raw config/patch files leaked into every
  generated project as stray output files
* Fixed `@Returns([string])` in generated routes — `string` is a TypeScript type keyword, not a runtime
  value; needed `[String]`. Compiled under vitest's SWC transform but failed a real `tsc` build
* Fixed `JWTUser`-shaped object literals (in `server.ts`'s telemetry token and the generated route test's
  authenticated-request test) including a `name` field that doesn't exist on `JWTUser` (only `uid`/`roles`/
  `scopes`) — moved to the token's `data` parameter instead; `HelloRoute.ts`/`templates/route`'s hello handler
  read `user.name` for the same reason and now use `user.uid`
* Fixed the generated route test's `config` import using the wrong relative path (`./config` instead of
  `../config.js`)
* Fixed the generated "create" test never setting any field on the new object, which failed the model's
  default non-nullable validation on its identifier — now seeded via the same `examplePropertyName`/
  `examplePropertyValue` machinery already used for the update tests
* Fixed generated route tests comparing `dateCreated`/`dateModified`/`version`/`_id` — all reassigned by the
  server or database on every write — against the client's stale pre-request copy; these are now excluded
  from the response-body comparison loops

**Correctness**

* Fixed `server.ts` deleting `expiresIn` directly off `config.get("auth")` when minting the long-lived
  service token used for `EventUtils` telemetry. `nconf.get()` returns a live reference into its own store,
  not a copy, so the delete removed `expiresIn` from the shared config for the rest of the process — every
  token issued afterward, including real user logins, came out with no expiration. Now deep-copies via
  `structuredClone()` before deleting, so only the service token is affected
