# RapidREST: CLI

[![CI](https://github.com/rapidrest/cli/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/rapidrest/cli/actions/workflows/build.yml)
[![Coverage Status](https://coveralls.io/repos/github/rapidrest/cli/badge.svg?branch=main)](https://coveralls.io/github/rapidrest/cli?branch=main)
[![npm version](https://img.shields.io/npm/v/@rapidrest/cli)](https://www.npmjs.com/package/@rapidrest/cli)

The official CLI tool for [RapidREST](https://github.com/rapidrest) projects.

For complete documentation please visit [RapidREST.dev](https://rapidrest.dev).

---

## Features

**Project Scaffolding**

- `generate server` scaffolds a complete REST server project in one command: MongoDB, PostgreSQL,
  SQLite, and/or Redis, an optional `/api` route prefix with a version segment, npm or yarn, source
  control initialization, and any combination of default routes, React, Docker, and Kubernetes
  support
- Every prompt has a matching flag, plus an `--answers` JSON file for reusing the same answers
  across projects, so a project can be scaffolded fully non-interactively for CI or repeated use
- Dependencies are installed automatically once scaffolding finishes (skip with `--no-install`)

**Code Generation**

- `generate model` adds a data model with typed properties (`string`, `number`, `boolean`, arrays,
  `Date`, or a custom type), optional Redis caching with a configurable TTL, and RBAC protection. If
  the project doesn't have a datastore yet, it creates one
- `generate route` adds a route handler, optionally bound to a model for full CRUD (list, get,
  create, update, delete, per-property update), with a matching test file generated alongside it
- `generate default-route` scaffolds any of RapidREST's built-in routes (Access Control Lists,
  Admin, Metrics, OpenAPI, Push, Static, Status), individually or as a batch
- `generate job` adds a cron-scheduled background job with its own test file
- `generate react` adds a managed React frontend with optional client-side hydration; running it
  again with a different name adds another app to the same project, migrating an older single-app
  layout automatically if needed
- `generate react-page` adds a page to an existing React app, with an optional companion service
  class for server-side data fetching

**Authentication**

- `generate auth` wires [`@rapidrest/auth`](https://github.com/rapidrest/auth) into a project as
  thin subclasses of the library's own model and route base classes rather than hand-written code:
  self-service registration, admin user management, and any combination of HTTP Basic, OTP, TOTP,
  Passkey, FIDO2, MFA, and OAuth 2.0/OpenID Connect login, with provider presets for Google, Apple,
  Facebook, and Microsoft, or a custom provider

**Deployment & Add-ons**

- `generate docker` adds a Dockerfile and Docker Compose setup, pre-configured for the project's
  datastores
- `generate k8s` adds a Helm chart under `helm/`, tailored the same way
- `react export` crawls a React app and writes a static HTML/CSS/JS build to disk, ready to deploy
  to any static host without a server

**Development Workflow**

- `dev` runs the server with hot reload, starting an in-memory database for each configured
  datastore automatically so no local database install is required, plus a watching frontend build
  when React support is configured
- `start` builds and runs the production server the same way, with automatic fallback to the next
  free port and an optional `--bun` flag that downloads and caches a compatible Bun runtime if one
  isn't already installed
- `build` compiles the project through its own package manager script, linting first unless skipped
  with `--no-lint`

**Project Maintenance**

- `doctor` checks an existing project against a set of known problem patterns and can fix the
  mechanically-safe ones automatically with `--fix`
- `upgrade` re-syncs a project's generator-owned boilerplate and dependency versions against the
  currently installed templates, touching only the files the project already has
- `dep add`/`install`/`remove` wrap the project's package manager; `dep upgrade` moves every
  dependency to its latest published version, not just within the existing semver range
- `test` runs the project's test suite through Vitest, with coverage and watch mode support
- `release` cuts a new version of a RapidREST project: bumps the version, promotes its release
  notes, summarizes commit history into the changelog, updates Helm chart versions if present, then
  commits, tags, and pushes

---

## Installation

```sh
npm install -g @rapidrest/cli
# or
yarn global add @rapidrest/cli
```

RapidREST requires Node.js LTS (24) or later.

Once installed, the CLI is available as both `rapidrest` and the shorter alias `rr`. Every example
below works with either name.

---

## Quick Start

```sh
# 1. Scaffold a new project (interactive prompts guide you through the options;
#    dependencies are installed automatically)
rapidrest generate server my-api
cd my-api

# 2. Create a new route
rapidrest generate route MyRoute

# 3. Start the development server
rapidrest dev
```

---

## Commands

- [`rapidrest generate server NAME`](#rapidrest-generate-server-name)
- [`rapidrest generate model NAME`](#rapidrest-generate-model-name)
- [`rapidrest generate route NAME`](#rapidrest-generate-route-name)
- [`rapidrest generate default-route`](#rapidrest-generate-default-route)
- [`rapidrest generate job NAME`](#rapidrest-generate-job-name)
- [`rapidrest generate docker`](#rapidrest-generate-docker)
- [`rapidrest generate k8s`](#rapidrest-generate-k8s)
- [`rapidrest generate react NAME`](#rapidrest-generate-react-name)
- [`rapidrest generate react-page APP NAME`](#rapidrest-generate-react-page-app-name)
- [`rapidrest generate auth`](#rapidrest-generate-auth)
- [`rapidrest dev`](#rapidrest-dev)
- [`rapidrest start`](#rapidrest-start)
- [`rapidrest build`](#rapidrest-build)
- [`rapidrest doctor`](#rapidrest-doctor)
- [`rapidrest upgrade`](#rapidrest-upgrade)
- [`rapidrest dep add`](#rapidrest-dep-add)
- [`rapidrest dep install`](#rapidrest-dep-install)
- [`rapidrest dep remove`](#rapidrest-dep-remove)
- [`rapidrest dep upgrade`](#rapidrest-dep-upgrade)
- [`rapidrest test`](#rapidrest-test)
- [`rapidrest release BUMP`](#rapidrest-release-bump)
- [`rapidrest react export`](#rapidrest-react-export)

---

### `rapidrest generate server NAME`

Scaffold a new RapidREST server project.

```
USAGE
  $ rapidrest generate server NAME [--output-dir <path>] [-a <name>] [--force]
      [--answers <path>] [--description <text>] [--pkg-manager npm|yarn]
      [--db <feature>...] [--route <type>...] [--react] [--docker] [--k8s]
      [--api-route] [--api-version <value>] [--scm <choice>] [--no-install]

ARGUMENTS
  NAME  Name of the new project (also used as the output directory name)

FLAGS
  --output-dir <path>     Directory to write the generated project into. Defaults to ./<NAME>
  -a, --author <name>     Author to attribute the generated code to (falls back to your Git config, then prompts)
  --force                 Overwrite existing files
  --answers <path>        Path to a JSON file supplying any of the flags below, for reuse across projects
  --description <text>    Short description of the project
  --pkg-manager <choice>  Node.js package manager: npm | yarn
  --db <feature>          A database feature to enable: mongodb | postgresql | redis | sqlite. Repeatable
  --route <type>          A default route to include: acl | admin | metrics | openapi | push | status. Repeatable
  --react / --no-react    Include React frontend support
  --docker / --no-docker  Include Docker support
  --k8s / --no-k8s        Include Kubernetes (Helm) support
  --api-route / --no-api-route  Prefix all non-React routes with `/api`
  --api-version <value>   API version segment when --api-route is set (e.g. "1" for /api/v1)
  --scm <choice>          Source control manager: github | gitlab | git | p4 | svn | none
  --no-install            Skip running the package manager install after generating
```

Every flag above stands in for one interactive prompt — pass it (or supply it via `--answers`) to
skip that prompt; omit both to be asked interactively, exactly as before these flags existed:

| Prompt | Description | Flag |
|--------|---------|------|
| Project description | Textual description of your project | `--description` |
| Author | The author of the project | `--author` (falls back to your Git config, then prompts) |
| Package manager | The desired Node.js package manager | `--pkg-manager` |
| Databases | Desired database(s) to use in the project | `--db` (repeatable) |
| Additional features | Default routes, React, Docker, Kubernetes | `--route` (repeatable) / `--react` / `--docker` / `--k8s` — see note below |
| API prefix | Whether to prefix all non-React routes with `/api` | `--api-route` (+ `--api-version`) |
| Source control | The SCM to use for the project | `--scm` |

`--route`/`--react`/`--docker`/`--k8s` all stand in for the same single "additional features"
checkbox, so they're treated as one group: passing **any one** of them (or its `--answers`
equivalent) skips that checkbox entirely, and any of the four you didn't specify falls back to
that checkbox's own default (`--route` → none, `--react` → off, `--docker` → **on**, `--k8s` →
off) rather than prompting for just the rest.

Any default routes selected above are generated via [`generate default-route`](#rapidrest-generate-default-route) immediately after the project is scaffolded, using the same author and API prefix you chose here.

Once the project is written, its dependencies are installed automatically via the package manager
you chose (or detected). Pass `--no-install` to skip this and run it yourself later.

**`--answers <file>`** — a JSON file with any of the flags above as camelCase keys, every key
optional:
```json
{
  "description": "A product catalog service",
  "author": "Jane Doe <jane@example.com>",
  "pkgManager": "npm",
  "db": ["mongodb", "redis"],
  "route": ["admin", "status"],
  "react": false,
  "docker": true,
  "k8s": false,
  "apiRoute": true,
  "apiVersion": "1",
  "scm": "github"
}
```
An explicit flag always overrides the same field in the file; either overrides the interactive
prompt for that field.

**Example:**

```sh
rapidrest generate server my-api
# → prompts for all options, then writes my-api/ with the selected features

rapidrest generate server my-api --output-dir ~/projects/my-api
rapidrest generate server my-api --author "Jane Doe <jane@example.com>"

# Fully non-interactive, via flags:
rapidrest generate server my-api --description "..." --pkg-manager npm \
  --db mongodb --db redis --route admin --route status \
  --docker --api-route --api-version 1 --scm github

# Fully non-interactive, via a reusable profile:
rapidrest generate server my-api --answers ./server-profile.json
```

---

### `rapidrest generate model NAME`

Generate a new data model class inside the current project.

```
USAGE
  $ rapidrest generate model NAME [--output-dir <path>] [-a <name>] [-d <text>]
      [--datastore <name>] [-c [ttl]] [-p] [--property <name:type>...] [-f] [--no-install]

ARGUMENTS
  NAME  Name of the data model class (e.g. Product, UserProfile)

FLAGS
  -f, --force              Overwrite existing files
  -p, --protect            Enable RBAC-based protection for this model
  -o, --output-dir <path>  Directory to write the generated model into. Defaults to ./src/models
  -a, --author <name>      Author to attribute the generated code to
  -c, --cache [ttl]        Cache TTL (in seconds) for this model
  -d, --description <text> Short description of the model
  --datastore <name>       Name of the datastore the model will be bound to (also usable as --ds)
  --property <name:type>   Add a typed property to the model (e.g. quantity:number). Append ? to the type
                            for an optional property (e.g. bio:string?). Repeatable
  --no-install             Skip running the package manager install after generating
```

If the project does not contain an existing datastore, or you simply want to set up a different
datastore than previously configured, this command will help you create a new one.

`--cache` has three forms:

- Omitted entirely — you're asked whether to enable caching; if you confirm, you're then prompted for a TTL (default `60`)
- Passed with no value (`--cache`) — caching is enabled with the default TTL of `60` seconds
- Passed with a value (`--cache 120`) — caching is enabled with that TTL in seconds

Every model already has a `name: string` field (its `@Identifier`, used to look records up by
their REST URL) — `--property`/the interactive prompt add further data properties alongside it,
not instead of it. When no `--property` flags are passed, you're prompted in a loop ("Property
name (leave blank to finish adding properties):", then its type — `string`/`number`/`boolean`/
`string[]`/`number[]`/`Date`, or a free-text "Other…" type — then whether it's optional, then an
optional short description); leave the name blank to stop. An optional property is declared as
`type | undefined` with `@Nullable` and defaults to `undefined`; a required property gets a
type-appropriate zero value (`""`, `0`, `false`, `[]`, `new Date()`). A custom "Other…" type has no
known shape, so it's initialized `undefined as any` unless marked optional.

**Example:**

```sh
rapidrest generate model Product
# → creates src/models/Product.ts

rapidrest generate model Product --datastore mongo --cache 120 --protect

rapidrest generate model Product --datastore mongo --cache --protect \
  --property quantity:number --property tags:string[] --property "bio:string?"
```

---

### `rapidrest generate route NAME`

Generate a new route handler inside the current project.

```
USAGE
  $ rapidrest generate route NAME [--output-dir <path>] [-a <name>] [-d <text>]
      [--path <route-path>] [--api <version>] [-m <name>] [--no-model] [-p] [-f]

ARGUMENTS
  NAME  Name of the route class (e.g. ProductRoute, OrderRoute)

FLAGS
  -f, --force               Overwrite existing files
  -p, --protect             Enable RBAC-based protection for this route
  -a, --author <name>       Author to attribute the generated code to
  -d, --description <text>  Short description of the route
  -m, --model <name>        Name of the model class this route will serve (extends ModelRoute)
  --output-dir <path>       Directory to write the generated route into. Defaults to ./src/routes
  --path <route-path>       Base path of the route (e.g. /api/v1/products)
  --api <version>           Use @ApiRoute instead of @Route for the generated route. Pass a version to prefix the
                             path with /api/v<version>; pass an empty value for /api with no version
  --no-model                Skip all prompts about associating a model class
```

If `--api` is omitted, you're asked whether this is an API route; confirming then prompts for a version (blank for no version prefix). Passing `--api <version>` skips both prompts and generates the route with `@ApiRoute(path, version)` instead of `@Route(path)`.

When selecting or creating a data model for the route handler, the resulting class will extend the `ModelRoute` base class and automatically include the following default endpoints:

* `HEAD /<path>` - Count all documents matching a given query of the specified <model> in the datastore
* `GET /<path>` - Find all documents matching a given query of the specified <model> in the datastore
* `POST /<path>` - Create one or more documents of the specified <model> in the datastore
* `DELETE /<path>` - Deletes all documents matching a given query of the specified <model> in the datastore
* `GET /<path>/:id` - Retrieve a single document for the given `id`
* `PUT /<path>/:id` - Updates a single document for the given `id`
* `PUT /<path>/:id/:property` - Updates a single property of the document with the given `id`
* `DELETE /<path>/:id` - Deletes a single document for the given `id`

A matching test file is always generated alongside the route, at `test/<NAME>.test.ts`.

**Example:**

```sh
rapidrest generate route ProductRoute
# → creates src/routes/ProductRoute.ts and test/ProductRoute.test.ts

rapidrest generate route ProductRoute --model Product --cache --protect
```

---

### `rapidrest generate default-route`

Generate one or more of RapidREST's built-in default route handlers (Access Control Lists, Admin, Metrics, OpenAPI, Push, Static, Status) inside the current project. `generate server` runs this automatically for whichever default routes you select there — this command lets you add or regenerate them independently on an existing project.

```
USAGE
  $ rapidrest generate default-route [--output-dir <path>] [-a <name>]
      [--api-route] [--api <version>] [-t <type>]... [--static-path <path>] [-f]

FLAGS
  -f, --force              Overwrite existing files
  -a, --author <name>      Author to attribute the generated code to
  -t, --type <type>        The type of default route to generate: acl, admin, metrics, openapi, push, static, status.
                           Pass more than once to generate multiple route types
  --output-dir <path>      Directory to write the generated route(s) into. Defaults to ./src/routes
  --api-route / --no-api-route  Use @ApiRoute instead of @Route for the generated route(s). Omit both
                           --api-route and --api to be prompted
  --api <version>          API version to prefix paths with (e.g. "1" for /api/v1) when --api-route is set. Passing
                           --api with a value on its own also implies --api-route
  --static-path <path>     Path containing the static files to serve, when the static route is included. Defaults to
                           `public`
```

A bare `--api` with no value can't reliably be told apart from `--api` followed by another flag,
so it's not supported — pass `--api-route` alone (no value needed) for "on, no version", or
`--api-route --api <version>` / `--api <version>` for a specific version, or `--no-api-route` to
skip the prompt and force it off.

If `--type` is omitted, you're shown a checklist of all seven default routes to choose from interactively (Admin, Metrics, OpenAPI, and Status are checked by default; ACL, Push, and Static are not). Pass `--type` one or more times to generate specific routes non-interactively — handy for scripting or CI:

```sh
rapidrest generate default-route --type acl --type admin --type status
```

`ACLRoute` automatically binds to `AccessControlListMongo` or `AccessControlListSQL` depending on whether the project has a MongoDB datastore configured.

When the static route is included, you're asked for the path containing the files to serve (default `public`) unless `--static-path` is passed; this also patches `src/config.ts` with a top-level `static_files` setting pointing at that path.

**Example:**

```sh
cd my-api
rapidrest generate default-route
# → interactive checklist of default routes to add

rapidrest generate default-route --type openapi --type metrics --api 1
# → creates src/routes/OpenAPIRoute.ts and src/routes/MetricsRoute.ts, both using @ApiRoute(path, "1")

rapidrest generate default-route --type static --static-path assets
# → creates src/routes/StaticRoute.ts and adds static_files: "assets" to src/config.ts
```

---

### `rapidrest generate job NAME`

Generate a new background job inside the current project.

```
USAGE
  $ rapidrest generate job NAME [--output-dir <path>] [-a <name>] [-d <text>]
      [-s <cron>] [-f]

ARGUMENTS
  NAME  Name of the background job class (e.g. MetricsCollector, Notificatier)

FLAGS
  -f, --force               Overwrite existing files
  -a, --author <name>       Author to attribute the generated code to
  -d, --description <text>  Short description of the job
  -o, --output-dir <path>   Directory to write the generated job into. Defaults to ./src/jobs
  -s, --schedule <cron>     Crontab-style schedule the job runs on (e.g. `* * * * *` runs every minute)
```

A matching test file is always generated alongside the job, at `test/jobs/<NAME>.test.ts`.

**Example:**

```sh
rapidrest generate job MetricsCollector
# → creates src/jobs/MetricsCollector.ts and test/jobs/MetricsCollector.test.ts

rapidrest generate job MetricsCollector --schedule "*/5 * * * *" --description "Collects system metrics"
```

---

### `rapidrest generate docker`

Add Docker support to the current project.

```
USAGE
  $ rapidrest generate docker [--output-dir <path>] [--has-react] [-f]

FLAGS
  -f, --force              Overwrite existing files
  --output-dir <path>      Project directory to add Docker support to. Defaults to the current working directory
  --has-react / --no-has-react  Whether the project includes a React app (affects which directories the
                           Dockerfile copies). Defaults to auto-detecting an existing project
```

Generates a set of Docker and Docker Compose files with pre-configured databases based on the existing project configuration.

**Example:**

```sh
cd my-api
rapidrest generate docker
docker-compose up
```

---

### `rapidrest generate k8s`

Add Kubernetes (Helm) support to the current project.

```
USAGE
  $ rapidrest generate k8s [--output-dir <path>] [--no-install] [-f]

FLAGS
  -f, --force              Overwrite existing files
  --output-dir <path>      Project directory to add Kubernetes (Helm) support to. Defaults to the current working directory
  --no-install             Skip running the package manager install after generating
```

Generates a Helm chart under `helm/`, tailored to the project's configured datastores.

**Example:**

```sh
cd my-api
rapidrest generate k8s
```

---

### `rapidrest generate react NAME`

Add a RapidREST-managed React frontend application to the current project.

```
USAGE
  $ rapidrest generate react NAME [--output-dir <path>] [-a <name>] [-p <base-path>]
      [--hydrate] [--no-install] [-f]

ARGUMENTS
  NAME  Name of the React app (e.g. app)

FLAGS
  -f, --force              Overwrite existing files
  -a, --author <name>      Author to attribute the generated code to
  -p, --path <path>        Base path the React application will route to. Defaults to /<NAME>
  --output-dir <path>      Project directory to add React support to. Defaults to the current working directory
  --hydrate                Enable client-side hydration (required for interactive apps)
  --no-install             Skip running the package manager install after generating
```

Running this a second time with a different `NAME` adds a second app to the same project — every
app gets its own `apps/<name>/` directory, its own `ReactRoute` subclass (its own `appDir` and
`@Route` mount path), and `vite.config.ts`/`tsconfig.client.json` are regenerated to cover every
app in the project. If the project's first app was generated before multi-app support existed
(a plain `app/` directory, not yet under `apps/`), it's **migrated automatically** — moved to
`apps/<name>/` and its route class updated — no manual restructuring step required.

**Example:**

```sh
cd my-api
rapidrest generate react app
rapidrest generate react app --path /dashboard --hydrate
rapidrest dev

# Add a second app — migrates app/ to apps/app/ if needed, regenerates vite.config.ts for both
rapidrest generate react admin --path /admin
```

---

### `rapidrest generate react-page APP NAME`

Add a new page to an existing React app in the current project.

```
USAGE
  $ rapidrest generate react-page APP NAME [--output-dir <path>] [-a <name>] [-s] [-f]

ARGUMENTS
  APP   Name of the React app to add the page to (e.g. app)
  NAME  Name of the page, optionally with a subpath (e.g. Dashboard, my/path/page)

FLAGS
  -f, --force              Overwrite existing files
  -s, --service            Create a service class for server-side data retrieval for the page
  -a, --author <name>      Author to attribute the generated code to
  --output-dir <path>      Project directory to add the page to. Defaults to the current working directory
```

Unless `--service` is passed, you're asked whether to generate a companion service class. If you decline, the page component instead exports a client-side `fetchProps` helper for retrieving its own data.

`NAME` may include a subpath (e.g. `my/path/page`), which nests the page component accordingly. The component and service class names are always derived by PascalCasing `NAME` — each `/`-, `-`, or `_`-separated segment is capitalized and joined, so `my/path/page` becomes `MyPathPage`.

Writes `apps/<APP>/<NAME>/index.tsx`. When a service class is created, it's written flat to `src/services/<PascalCase NAME>Service.ts` regardless of NAME's subpath.

**Example:**

```sh
cd my-api
rapidrest generate react-page app Dashboard
rapidrest generate react-page app Dashboard --service

# Nested page path — creates apps/app/my/path/page/index.tsx and src/services/MyPathPageService.ts
rapidrest generate react-page app my/path/page --service
```

---

### `rapidrest generate auth`

Add login/session scaffolding to the current project, backed by [`@rapidrest/auth`](https://github.com/rapidrest/auth): self-service registration, admin user management, and one or more selectable authentication methods — HTTP Basic, OTP, TOTP, Passkey, FIDO2, MFA, and OAuth 2.0/OpenID Connect (with presets for Google, Apple, Facebook, and Microsoft, or a custom provider). Opt-in — nothing in the base `generate server` template depends on this.

```
USAGE
  $ rapidrest generate auth [--datastore-type sql|mongo] [--sql-type postgres|better-sqlite3]
      [--default-accounts] [--method basic|otp|totp|passkey|fido2|mfa|oidc]...
      [--oidc-provider google|apple|facebook|microsoft|custom]...
      [-a <name>] [--output-dir <path>] [--no-install] [-f]

FLAGS
  -f, --force                Overwrite existing files
  -a, --author <name>        Author to attribute the generated code to
  --datastore-type <choice>  Which datastore backs authentication data: sql | mongo
  --sql-type <choice>        When --datastore-type sql and no "sql" datastore exists yet, which SQL
                              database to create it as: postgres | better-sqlite3
  --default-accounts         Also provision a default admin account the first time the server boots
                              against an empty user table
  --method <choice>          Which authentication method(s) to enable. Repeatable. One of: basic,
                              otp, totp, passkey, fido2, mfa, oidc
  --oidc-provider <choice>   When "oidc" is among --method, which third-party provider(s) to
                              configure. Repeatable. One of: google, apple, facebook, microsoft, custom
  --output-dir <path>        Directory to write the generated files into. Defaults to the current
                              working directory
  --no-install                Skip running the package manager install after generating
```

`@rapidrest/auth` ships ready-made model and route base classes — this command doesn't hand-write a
`User` model, it generates thin subclasses that wire them up. Files marked "always" are generated
regardless of which methods are selected; the rest are conditional on the matching `--method`:

| File | Condition | What it does |
|------|-----------|---------|
| `src/models/auth.ts` | always | Re-exports `User`/`Alias`/`Secret`/`Profile` (SQL or Mongo variant) so the server's ClassLoader discovers their metadata |
| `src/routes/RegistrationRoute.ts` | always | Self-service sign-up — creates a user and login alias, then issues a token |
| `src/routes/UserRoute.ts` | always | Admin CRUD over user accounts (deny-by-default ACL; grant access via `trusted_roles`) |
| `src/routes/AuthLogoutRoute.ts` | always | Clears the session cookie, if any |
| `src/routes/SecretRoute.ts` | always | CRUD over secrets (password, TOTP, passkey, FIDO2, recovery codes) — also how a password gets changed and how TOTP/Passkey/FIDO2 get enrolled |
| `src/routes/AuthBasicRoute.ts` | `basic` | Username/password (HTTP Basic) login |
| `src/routes/AuthOTPRoute.ts` | `otp` | One-time password (email/SMS) login |
| `src/routes/AuthTOTPRoute.ts` | `totp` | Authenticator-app (RFC 6238) login |
| `src/routes/AuthPasskeyRoute.ts` | `passkey` | WebAuthn passkey (synced credential) login |
| `src/routes/AuthFIDO2Route.ts` | `fido2` | WebAuthn hardware security key login |
| `src/routes/AuthMFARoute.ts` | `mfa` | Password + a second factor (FIDO2/OTP/recovery-code/TOTP) login |
| `src/routes/Auth<Provider>Route.ts` | one per selected `--oidc-provider` | OAuth 2.0/OIDC login for that provider |
| `src/jobs/DefaultAccounts.ts` | `--default-accounts` | Auto-provisions a default admin account on first boot |

**The datastore name matters.** `@rapidrest/auth`'s `User`/`Alias`/`Secret` model classes have a
fixed datastore binding baked in — literally named `sql` or `mongo` — so this command reuses an
existing datastore with that exact name if one exists, or creates one (patching `src/config.ts`)
if not. This is unlike `generate model`, where you can name a datastore anything.

Token issuing reuses the `auth:` block every generated project's `src/config.ts` already has.
Selecting `totp`/`fido2`/`mfa`/`passkey` adds the matching `auth.totp`/`auth.fido2`/`auth.passkey`
config block with sensible defaults; each selected OIDC provider adds its own `auth.oidc_<provider>`
block. `@rapidrest/auth` and `argon2` (used for password hashing) are always added to
`package.json`; `otplib` and `@simplewebauthn/server` are added when a method that needs them is
selected, and `jwks-rsa` when a selected OIDC provider uses OpenID Connect. Dependencies are then
installed automatically, unless `--no-install` is passed.

**OIDC providers.** Selecting `oidc` prompts for one or more third-party providers. Google, Apple,
Facebook, and Microsoft come with preset, well-known endpoints (verify these against the provider's
current `.well-known/openid-configuration` before deploying — they can change); `custom` prompts
for every endpoint by hand. For each provider you're prompted for a Client ID and Client Secret,
which are written into `src/config.ts` as plain strings — matching this file's existing convention
for every other secret-shaped value (`auth.secret`, `cookie_secret`, datastore passwords) — override
them in a real deployment via the environment (e.g. `AUTH__OIDC_GOOGLE__CLIENTSECRET`), same as any
other value there. Selecting more than one provider is fully supported: each gets its own route file
and a distinct registered strategy name, so they don't collide with each other.

**Out of scope** (all real, working parts of `@rapidrest/auth`, just not scaffolded by this
command): session refresh, account elevation, auth-method discovery, and direct Profile/Account/
Alias management routes. Add those by hand, following the same thin-subclass pattern as the routes
this command generates.

**Example:**

```sh
rapidrest generate auth
# → prompts for the datastore type and authentication method(s), then writes the matching files

rapidrest generate auth --datastore-type sql --sql-type better-sqlite3 --method basic
rapidrest generate auth --datastore-type mongo --default-accounts --method basic --method mfa
rapidrest generate auth --method oidc --oidc-provider google --oidc-provider apple
```

---

### `rapidrest dev`

Start the RapidREST server in development mode with hot reloading.

```
USAGE
  $ rapidrest dev [--inspect] [-d] [-p <value>]

FLAGS
  -d, --docker  Run in Docker mode (skips starting in-memory database servers)
  -p, --port    Preferred port to bind to (default 3000). If already in use, the next available port is used instead.
  --inspect     Enable the Node.js inspector on port 9229 for debugger attachment
```

Run this command from the root of a generated RapidREST project. It:

1. Reads `src/config.ts` to detect which databases are configured.
2. Starts an in-process, in-memory server for each configured database (MongoDB, PostgreSQL, and/or Redis) — no local database installation required. Pass `--docker` to skip this step when your databases are already running elsewhere (e.g. via `docker compose`).
3. Finds an available port to bind to, starting at 3000 (or `--port`, if given) and trying the next port up until a free one is found.
4. Starts the server via `tsx --watch`, watching `src/` for changes.
5. If the project has React support configured (a `vite.config.ts` is present), also starts `vite build --watch` concurrently.

All child processes and started databases are cleaned up on `CTRL+C`.

**Example:**

```sh
cd my-api
rapidrest dev
rapidrest dev --inspect   # attach a debugger on localhost:9229
rapidrest dev --docker    # assume databases are already running (e.g. via Docker Compose)
rapidrest dev --port 4000 # prefer port 4000, falling back to 4001, 4002, ... if occupied
```

---

### `rapidrest start`

Build and start the RapidREST server for production.

```
USAGE
  $ rapidrest start [--no-build] [--no-lint] [-d] [-p <value>] [--bun]

FLAGS
  -d, --docker  Run in Docker mode (skips starting in-memory database servers)
  -p, --port    Preferred port to bind to (default 3000). If already in use, the next available port is used instead.
  --no-build    Skip the build step
  --no-lint     Skip linting during the build step
  --bun         Use the Bun engine instead of Node.js. Requires Bun v1.4.0+; downloads a compatible version automatically if none is installed.
```

Run this command from the root of a generated RapidREST project. It:

1. If `--bun` is passed, resolves a Bun v1.4.0+ executable to run the server with (see below).
2. Runs `yarn build` or `npm run build` (auto-detected from `yarn.lock` / `package.json`), which lints the project first unless `--no-lint` is passed.
3. If the project has React support configured, also runs `vite build` to compile the frontend.
4. Reads `src/config.ts` to detect which databases are configured and starts an in-memory server for each one — unless `--docker` is passed, in which case this step is skipped.
5. Finds an available port to bind to, starting at 3000 (or `--port`, if given) and trying the next port up until a free one is found.
6. Starts the compiled server (`node dist/server.js`, or the equivalent path for your build output — or the resolved `bun` executable when `--bun` is passed).

**Bun support (`--bun`):** RapidREST requires Bun v1.4.0 or newer. When `--bun` is passed:
- If a compatible `bun` is already on your `PATH`, it's used directly.
- Otherwise, if a previously-downloaded compatible version exists in the local cache (`~/.rapidrest/bun/<version>/`), it's reused.
- Otherwise, the latest Bun release is downloaded automatically from GitHub and cached for future runs. If the latest available release is still older than v1.4.0, the command fails with a clear error rather than running under an incompatible runtime.

**Example:**

```sh
cd my-api
rapidrest start
rapidrest start --no-build   # skip build, just start databases + server
rapidrest start --docker     # assume databases are already running
rapidrest start --port 4000  # prefer port 4000, falling back to 4001, 4002, ... if occupied
rapidrest start --bun        # run the server with Bun, downloading a compatible version if needed
```

---

### `rapidrest build`

Build the RapidREST server project in the current directory (and its React frontend, if configured).

```
USAGE
  $ rapidrest build [--no-lint]

FLAGS
  --no-lint  Skip linting before building
```

Runs the project's `build` script via the detected package manager. Equivalent to `yarn build` or `npm run build` from the project root.

**Example:**

```sh
rapidrest build
rapidrest build --no-lint
```

---

### `rapidrest doctor`

Validate an existing RapidREST project against known issues and optionally fix them.

```
USAGE
  $ rapidrest doctor [--fix] [--json]

FLAGS
  --fix   Automatically apply fixes for findings that support it
  --json  Output findings as JSON instead of a formatted report
```

Run this from the root of a generated RapidREST project to check it against a set of known issues
— bug patterns that have been found to break generated projects (a datastore's `type` using this
CLI's own feature-flag name instead of TypeORM's driver literal, a missing `vitest.config.ts`,
`typeorm`/`redis` not resolvable for type-checking, an `eslint-plugin-import` + `eslint@10` conflict,
the old boolean-flag `ACLRecord` shape, and a few others). This is useful for projects that were
scaffolded a while ago and may have drifted from what the currently installed `@rapidrest/*`
libraries expect, not just freshly generated ones.

Each finding is reported with a severity (`error` or `warning`) and, where the fix is mechanical and
safe to apply automatically, a note that `--fix` can resolve it. Findings without a safe automatic
fix (e.g. the old ACL format, which needs a per-record judgment call to migrate correctly) are
reported for you to address by hand.

Exits with a non-zero code if any `error`-severity finding remains after fixing (or immediately, if
`--fix` wasn't passed).

**Example:**

```sh
rapidrest doctor          # report findings
rapidrest doctor --fix    # apply automatic fixes, then report what remains
rapidrest doctor --json   # machine-readable output, e.g. for CI
```

---

### `rapidrest upgrade`

Refresh an existing RapidREST project's generator-owned boilerplate files and dependency versions
against the currently installed templates.

```
USAGE
  $ rapidrest upgrade [--write] [--json]

FLAGS
  --write  Apply the changes. Without this flag, only reports what would change
  --json   Output the plan as JSON instead of a formatted report
```

Run this from the root of a generated RapidREST project. Unlike [`doctor`](#rapidrest-doctor),
which detects a fixed set of known-bad patterns, `upgrade` re-syncs a project against whatever the
currently installed CLI's templates actually contain — dependency version bumps, config/build-file
fixes, new boilerplate — the same way you'd get by hand-diffing a fresh scaffold against your
existing project, but automated.

It only ever touches a file that already exists in the project, and never creates a new one — a
project that never opted into Docker/Kubernetes/a given default route simply doesn't have that
file on disk, so nothing is added on its behalf. `src/config.ts` and `test/config.ts` are never
touched at all (they're user-edited and mutated by `generate model`/`generate route`'s patches, so
they need surgical handling — see `doctor`), and `package.json` is never overwritten wholesale:
only known dependency version pins are updated or added, your own added dependencies and `scripts`
are left exactly as they are.

**Example:**

```sh
rapidrest upgrade          # report what would change
rapidrest upgrade --write  # apply it
rapidrest upgrade --json   # machine-readable output, e.g. for CI
```

**Known limitations:**

- Copyright-year headers (`Copyright (C) {{year}} {{author}}`) will show as "changed" every time
  the calendar year rolls over — harmless, but expect a one-line diff on otherwise-unchanged files
  each January.
- If `src/routes/HelloRoute.ts` was deleted, the API route prefix can't be recovered, which can
  cause a false-positive diff on any surviving default-route file's decorator line.
- Dependency sync never *removes* a stale or renamed dependency (e.g. a package the template
  dropped) — that's [`doctor`](#rapidrest-doctor)'s job.

---

### `rapidrest dep add`

Add one or more dependencies to the current project.

```
USAGE
  $ rapidrest dep add PACKAGE... [-D]

ARGUMENTS
  PACKAGE  One or more package names to add (e.g. lodash-es, axios@1.19.0). Repeatable

FLAGS
  -D, --dev  Add as a devDependency instead of a dependency
```

Equivalent to `yarn add`/`npm install <pkg>` via the detected package manager.

**Example:**

```sh
rapidrest dep add lodash-es
rapidrest dep add axios@1.19.0
rapidrest dep add vitest --dev
```

---

### `rapidrest dep install`

Install the current project's dependencies.

```
USAGE
  $ rapidrest dep install
```

Equivalent to `yarn install`/`npm install` via the detected package manager.

---

### `rapidrest dep remove`

Remove one or more dependencies from the current project.

```
USAGE
  $ rapidrest dep remove PACKAGE...

ARGUMENTS
  PACKAGE  One or more package names to remove. Repeatable
```

Equivalent to `yarn remove`/`npm uninstall` via the detected package manager.

**Example:**

```sh
rapidrest dep remove lodash-es
rapidrest dep remove axios lodash-es
```

---

### `rapidrest dep upgrade`

Upgrade the current project's dependencies to their latest published versions — a real mass
upgrade, unlike `npm update`/`yarn upgrade`, which only move within your existing semver range.

```
USAGE
  $ rapidrest dep upgrade [PACKAGE...] [--dry-run] [--exclude <name>...] [--no-install] [--peer]

ARGUMENTS
  PACKAGE  Specific package(s) to upgrade, optionally pinned to a version (e.g. lodash-es@4.17.21,
           axios:1.19.0). Omit to upgrade every dependency

FLAGS
  --dry-run          List what would be upgraded without changing anything
  --exclude <name>   Package name to exclude from the upgrade. Repeatable
  --no-install       Skip running the package manager install after upgrading
  --peer             Also consider peerDependencies when no specific packages are named
```

Without any package arguments, every dependency (and devDependency) in `package.json` is checked
against its latest published version; passing one or more packages upgrades only those. Packages
already at their latest version are reported and skipped, not treated as an error.

**Example:**

```sh
rapidrest dep upgrade
rapidrest dep upgrade --dry-run
rapidrest dep upgrade lodash-es axios
rapidrest dep upgrade lodash-es@4.17.21 axios:1.19.0
rapidrest dep upgrade --exclude typescript --exclude eslint
```

---

### `rapidrest test`

Run the current project's test suite via Vitest.

```
USAGE
  $ rapidrest test [FILE...] [--coverage] [--watch]

ARGUMENTS
  FILE  Optional test file path(s)/pattern(s) to run, passed straight through to Vitest

FLAGS
  --coverage  Run tests with code coverage
  --watch     Run tests in watch mode instead of a single pass
```

**Example:**

```sh
rapidrest test
rapidrest test --coverage
rapidrest test --watch
rapidrest test src/routes/HelloRoute.test.ts
```

---

### `rapidrest release BUMP`

Cut a new release of the current project.

```
USAGE
  $ rapidrest release BUMP [--preid <id>] [--dry-run] [--no-push]

ARGUMENTS
  BUMP  Release strategy (major|minor|patch|premajor|preminor|prepatch|prerelease) or an explicit
        x.y.z version

FLAGS
  --preid <id>  Prerelease identifier (e.g. "rc") for pre* strategies
  --dry-run     Print the computed version and exit without changing anything
  --no-push     Commit and tag locally but skip `git push`
```

Run this from the root of a project that follows the same `RELEASE_NOTES.md`/`CHANGELOG.md`
conventions as this CLI's own repository. It:

1. Computes the new version from `BUMP` (a semver strategy, applied via `npm version`'s rules, or an explicit version).
2. Bumps `package.json`.
3. Promotes `RELEASE_NOTES.md`'s `## Unreleased` heading to `## v<version>` — the file must have that heading, or the command fails before making any changes.
4. Summarizes the commit messages since the last tag into a new entry in `CHANGELOG.md`.
5. If a Helm chart is present under `helm/`, updates its `Chart.yaml`/`values.yaml` version fields.
6. Commits the changes, tags the commit `v<version>`, and pushes both — unless `--no-push` is passed.

Requires a clean working tree (no staged or unstaged changes) before it will touch anything.
`--dry-run` prints the computed version and exits before any of the above happens, so it's safe to
use as a check.

**Example:**

```sh
rapidrest release patch
rapidrest release 2.1.0 --dry-run
rapidrest release prerelease --preid rc --no-push
```

---

### `rapidrest react export`

Crawl the React app and write a static HTML/CSS/JS site to disk — no server required to serve the
result. Namespaced under the `react` topic (rather than a bare top-level `export`) so it's clear
what's being exported. Requires a React app to be configured (see
[`rapidrest generate react`](#rapidrest-generate-react-name)).

```
USAGE
  $ rapidrest react export [-d] [-p <value>]

FLAGS
  -d, --docker  Run in Docker mode (skips starting in-memory database servers)
  -p, --port    Preferred port to bind the transient export server to (default 3000). If already in use, the next available port is used instead.
```

Run this command from the root of a generated RapidREST project with React support. It:

1. Reads `src/config.ts` to detect which databases are configured and starts an in-memory server for each one — unless `--docker` is passed, in which case this step is skipped. The export entry boots a real, fully-wired server, so it has the same database requirements as `dev`/`start`.
2. Finds an available port to bind the transient export server to, starting at 3000 (or `--port`, if given), so it doesn't collide with an already-running `rapidrest dev`/`rapidrest start`. Nothing is served on this port afterward — it only exists for the duration of the crawl.
3. Delegates to `@rapidrest/react`'s own CLI (`rapidreact export`), which builds the client bundle (`vite build`) and then runs the project's `src/export.ts` entry (generated automatically by `rapidrest generate react`) under `NODE_ENV=production`.

The result is written to `dist/export/` — `index.html`, one `index.html` per page path, `404.html` for static-host fallback routing, and a copy of the built hydration assets. Deploy that directory to any static host (S3, Netlify, GitHub Pages, a CDN).

**Known limitations** (inherited from `rapidreact export` — see [`@rapidrest/react`'s README](https://github.com/rapidrest/react#static-export)):

- No support for dynamic/parameterized routes.
- Hydration only works correctly when the exported site is served from `/`.
- Props are frozen at export time — pages depending on per-request or authenticated data will bake in whatever an unauthenticated crawl renders.

**Example:**

```sh
cd my-api
rapidrest react export
rapidrest react export --docker     # assume databases are already running
rapidrest react export --port 4000  # prefer port 4000 for the transient export server
```

---

## Regenerating add-ons after project changes

`generate docker` and `generate k8s` are idempotent and safe to re-run with `--force` whenever the project's datastores change — they regenerate their output entirely from the current project state rather than patching existing files. `generate model` will offer to do this for you automatically when you configure a brand-new datastore while adding a model.

---

## License

MPL v2.0 — see [LICENSE](./LICENSE).
