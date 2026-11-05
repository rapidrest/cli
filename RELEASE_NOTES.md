# Release Notes

## v3.0.0

### Breaking

* **The templates are no longer part of the npm package.** They are released on their own, as GitHub releases of this
  repository tagged `templates-v<version>`, so templates (and the dependency versions they write) can change without a
  CLI release. The CLI downloads the newest templates it can use the first time a command needs them and caches them
  in `~/.rapidrest/templates/` (or `$RAPIDREST_HOME/templates/`), so the first `generate` needs network access. Offline,
  the cached copy is used, or pass `--templates <directory|zip>`. See the README's Templates section.

### Added

* Inside an existing project, only templates compatible with it are used: templates from the major the project was
  scaffolded with, targeting the `@rapidrest` majors it has installed. A project keeps receiving template fixes and is
  never moved to templates written for framework versions it doesn't use
* A new project records the templates version it was scaffolded from in its `package.json`
  (`"rapidrest": { "templates": "1.0.0" }`), and its `@rapidrest/cli` devDependency is the CLI that scaffolded it
* `--templates <version|directory|zip>` (or `RAPIDREST_TEMPLATES`) on every command that renders templates (`generate *`,
  `upgrade`, `doctor`), to pick a templates release or use a local copy
* `upgrade --latest` moves a project to the newest templates this CLI supports, across a templates major, for a project
  moving to new `@rapidrest` majors. `upgrade --write` records the templates version it applied
* Dependency versions written as `^<major>` in the templates are resolved to the newest matching release when you
  scaffold, so a new project starts on current versions. If the registry can't be reached, the range is written as is
* `generate react --router` (and a prompt) for `@rapidrest/react`'s client-side navigation between an app's pages. It
  sets `router = true` on the app's route and builds the router in `vite.config.ts`
* `generate auth` also generates `AuthElevationRoute` (`/auth/elevation`). Without it, nothing could perform a
  `@RequiresElevation` action: changing secrets, managing users, or the admin `restart`/`clear-cache` endpoints
* `generate auth` re-exports `@rapidrest/auth`'s `SystemSettings` model, which the generated registration, secret,
  user and OIDC routes use
* Templates `1.0.0`: `@rapidrest/core` 6.1, `@rapidrest/service-core` 2.5, `@rapidrest/auth` 2.0 and
  `@rapidrest/react` 2.3
* Every `generate` prompt can now be answered by a flag, so the commands can run unattended (in scripts, CI, or by an
  agent without a terminal):
  * `generate model`: `--no-cache`, `--no-protect`, `--no-properties`, `--datastore-type mongodb|postgres|sqlite` for
    a new datastore, and `--update-docker`/`--no-update-docker` and `--update-k8s`/`--no-update-k8s` for regenerating
    the deployment files after one is added
  * `generate route`: `--no-api` and `--no-protect`
  * `generate react`: `--no-router` and `--no-hydrate`; `generate react-page`: `--no-service`
  * `generate auth`: `--oidc-client-id <provider>=<id>`, `--oidc-credentials-from-env` (leave the client secrets, and
    any client IDs not given, empty in `config.ts`, to be supplied through the environment instead of typed in), and
    `--oidc-custom-authorization-url`, `-token-url`, `-profile-url`, `-protocol`, `-issuer`, `-jwks-uri` and `-scope`
    for a custom provider

### Fixed

* `generate react-page --service` wrote a `@ReactService` path that `@rapidrest/react` 2.x never registers, so the page
  silently got none of its service's props. The path is now the page's public URL under the app's mount path
* `generate auth` copied the OIDC provider template (`oidc-provider/`) into every project
* A generated project's tests couldn't start its server: the auth method (TOTP, passkey, FIDO2), OIDC provider and
  React manifest settings were only added to `src/config.ts`. They are now added to `test/config.ts` too, with an
  in-memory test datastore for auth
* The generated CORS allow-list was ignored, allowing every origin: the config key is `cors.origins`, not
  `cors.origin`. Since `@rapidrest/service-core` 2.5 the same list also decides which origins may open a WebSocket
* Generated projects were missing `.gitignore` and `.npmignore`, which npm packaging dropped from the templates
* A project with a background job failed to build and test: the generated job test imported `./config` instead of
  `../config`, and its empty test bodies failed the project's lint. The test now exercises the job's schedule, `start()`,
  `run()` and `stop()`
* `generate model --datastore <name>` with a name that isn't configured bound the model to an empty, type-less
  datastore block in `src/config.ts` (and none in `test/config.ts`), so the server and every test failed to start. It
  now sets up a new datastore of that name, asking for its type (or taking `--datastore-type`), with its drivers, and
  adds it to `test/config.ts` too (in-memory sqlite for SQL, the test MongoDB for MongoDB). A datastore name that isn't
  a valid identifier is rejected
* `generate model` didn't offer to update the Docker and Helm files after setting up a project's first datastore
* Entries added to a nested `config.ts` block (a new datastore, auth or React settings) were indented one level too
  shallow, and pushed the block's closing brace to the start of the line
* `generate model`, `route`, `job` and `react` reported the wrong path for the generated file (the project directory
  instead of `src/models/`, `src/routes/`, `src/jobs/` or `apps/`), and their `--output-dir` help described a
  `src/...` directory when it takes the project directory
* A custom OIDC provider's default scopes (`openid email profile`) were written as one scope, since only commas
  separated scopes. Spaces now do too
* `generate auth`'s examples used `--sql-type sqlite`, which it rejects (`better-sqlite3`), and its help still listed
  account elevation as not scaffolded

### CI

* The CLI is published only from a release tag's own Build, and only once every Build of that commit has passed
* Prereleases are published to npm under the `next` tag, and releases under `latest`
* The validate job enables corepack, so its `yarn npm audit` actually runs
* Every workflow installs corepack before enabling it, since Node 25 and later no longer bundle it
* Pinned Yarn (`packageManager: yarn@4.12.0`). Without it, CI ran the image's Yarn 1 against the Yarn 4 lockfile, so
  every Build since September failed installing dependencies, and the validate job's audit never ran
* The test job installs git (the release tests use it) and runs the tests as an unprivileged user, since embedded
  Postgres refuses to run as root
* Updated `handlebars` (4.7.10), `undici` (8.12.3) and the transitive `brace-expansion`, `follow-redirects` and
  `undici` 6 to versions without known high-severity advisories
* A new Templates workflow publishes a templates release from a `templates-v*` tag's green Build, and
  `yarn release templates <bump>` cuts one

## v2.1.0

* Fixed `release` stripping every comment from a Helm chart's `values.yaml` and `Chart.yaml`: it now changes only the `service.image.tag` and `appVersion` lines
* Fixed `release` replacing every version-like string in `README.md` (turning `127.0.0.1` into the new version, and rewriting other projects' versions): it now updates only the Docker Image table's `Tag` row and the `--version` of the project's own chart reference
* Fixed `release` rewriting other `*_VERSION=` assignments in `single_node_install.sh`; only `VERSION=` is updated, keeping its quoting

## v2.0.0

* Fixed issue that created database processes to not be cleaned up after a `dev` or `start` command
* Fixed `react export` issue that caused the process to hang indefinitely
* Added changelog/contributing files to server template
* Updated server template's ci.yaml GitHub workflow with multiple fixes
* Removed unused files from react template
* Updated server template to `service-core` version `^2.0.0`
* Upgraded all dependencies to latest version for react/server templates
* The `dev` command now sets `NODE_ENV` to `development`

## v1.0.1

* Fixed react template to add missing manifestPath to config.ts

## v1.0.0

The official CLI for scaffolding, developing, and maintaining RapidREST projects. Available as both `rapidrest` and the shorter `rr` alias.

### Project Scaffolding

* `generate server` scaffolds a complete REST server project in one command: MongoDB, PostgreSQL, SQLite, and/or Redis, an optional `/api` route prefix with a version segment, npm or yarn, source control initialization, and any combination of default routes, React, Docker, and Kubernetes support
* Every prompt has a matching flag, plus an `--answers` JSON file for reusing the same answers across projects, so a project can be scaffolded fully non-interactively for CI or repeated use

### Code Generation

* `generate model` adds a data model with typed properties (`string`, `number`, `boolean`, arrays, `Date`, or a custom type), optional Redis caching with a configurable TTL, and RBAC protection. If the project doesn't have a datastore yet, it creates one
* `generate route` adds a route handler, optionally bound to a model for full CRUD (list, get, create, update, delete, per-property update), with a matching test file generated alongside it
* `generate default-route` scaffolds any of RapidREST's built-in routes (Access Control Lists, Admin, Metrics, OpenAPI, Push, Static, Status), individually or as a batch
* `generate job` adds a cron-scheduled background job with its own test file
* `generate react` adds a managed React frontend with optional client-side hydration; running it again with a different name adds another app to the same project, migrating an older single-app layout automatically if needed
* `generate react-page` adds a page to an existing React app, with an optional companion service class for server-side data fetching

### Authentication

* `generate auth` wires `@rapidrest/auth` into a project as thin subclasses of the library's own model and route base classes rather than hand-written code: self-service registration, admin user management, and any combination of HTTP Basic, OTP, TOTP, Passkey, FIDO2, MFA, and OAuth 2.0/OpenID Connect login, with provider presets for Google, Apple, Facebook, and Microsoft, or a custom provider

### Deployment & Add-ons

* `generate docker` adds a Dockerfile and Docker Compose setup, pre-configured for the project's datastores
* `generate k8s` adds a Helm chart under `helm/`, tailored the same way
* `react export` crawls a React app and writes a static HTML/CSS/JS build to disk, ready to deploy to any static host without a server

### Development Workflow

* `dev` runs the server with hot reload, starting an in-memory database for each configured datastore automatically so no local database install is required, plus a watching frontend build when React support is configured
* `start` builds and runs the production server the same way, with automatic fallback to the next free port and an optional `--bun` flag that downloads and caches a compatible Bun runtime if one isn't already installed
* `build` compiles the project through its own package manager script

### Project Maintenance

* `doctor` checks an existing project against a set of known problem patterns and can fix the mechanically-safe ones automatically with `--fix`
* `upgrade` re-syncs a project's generator-owned boilerplate and dependency versions against the currently installed templates, touching only the files the project already has
* `dep add`/`install`/`remove` wrap the project's package manager; `dep upgrade` moves every dependency to its latest published version, not just within the existing semver range
* `test` runs the project's test suite through Vitest, with coverage and watch mode support
* `release` cuts a new version of a RapidREST project: bumps the version, promotes these release notes, summarizes commit history into the changelog, updates Helm chart versions if present, then commits, tags, and pushes
