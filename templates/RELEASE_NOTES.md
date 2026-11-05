# Templates Release Notes

The templates are released on their own (tags `templates-v<version>`), separately from the CLI. See README.md.

## v1.2.0

* Fixed `route`'s generated test failing `findById` with 403: the request was anonymous, and since
  `@rapidrest/service-core` 2.5 a `.*` ACL record only matches an authenticated user. It now sends the record owner's
  token.
* Fixed `route`'s generated test hanging when the project's datastores are of mixed kinds (a SQL model with MongoDB
  ACLs) or the route has no model in a MongoDB project: it now starts the test MongoDB whenever the project has one, and
  reads ACLs through the `acl` datastore's own repository type.
* Fixed a model-less `route`'s test expecting `Hello World!` from an authenticated request, which the route answers
  with the user's uid.
* Needs template engine 1.2 (`engine: ^1.2.0`).

## v1.1.1

* Fixed a new SQLite or PostgreSQL project failing to install its dependencies with npm (`ERESOLVE`): the server
  template asked for `better-sqlite3` 13, which `typeorm` 1.1 doesn't support. It now asks for 12, as `generate model`
  already did.

## v1.1.0

* A new project includes `.claude/settings.json`, which registers the RapidREST Claude Code plugin's marketplace
  (`rapidrest/claude-plugin`, auto-updating) and enables the plugin, so anyone opening the project in Claude Code is
  offered the RapidREST skills once they trust the folder.
* Needs template engine 1.1 (`engine: ^1.1.0`), whose `upgrade` never overwrites `.claude/settings.json`, so an older
  CLI can't replace a project's own Claude Code settings with the template's.
* Fixed a new project's `test` (and so its CI) failing until its first test was generated: Vitest exited with an error
  when it found no test files. It now passes with none.

## v1.0.0

The first release of the templates on their own, targeting `@rapidrest/core` 6, `@rapidrest/service-core` 2,
`@rapidrest/auth` 2 and `@rapidrest/react` 2. Needs template engine 1 (the first CLI release that downloads its
templates).

* Dependency versions are written as `^<major>` (or `^0.<minor>`) and resolved to the newest matching release when a
  project is scaffolded, so a routine dependency update no longer needs a templates release.
* A new project records the templates version it was scaffolded with in package.json (`rapidrest.templates`), and its
  `@rapidrest/cli` devDependency is the CLI that scaffolded it.
* `auth` generates `AuthElevationRoute` (`/auth/elevation`), required by every `@RequiresElevation` action, and
  re-exports the `SystemSettings` model its routes use.
* `react` can enable `@rapidrest/react`'s client-side navigation (`router = true`).
* Fixed `react-page`'s `@ReactService` path, which `@rapidrest/react` 2.x never registered: it is now the page's
  public URL under the app's mount path.
* Fixed a generated project's tests failing to start the server: auth method, OIDC provider and React manifest
  settings are now added to `test/config.ts` too.
* Fixed the generated GitHub and GitLab CI and the Dockerfile failing on Node 25 and later (including the current
  `node:lts` images), which no longer bundle corepack: they install it before enabling it.
* Fixed the CORS allow-list being ignored (`cors.origins`, not `cors.origin`); since `@rapidrest/service-core` 2.5 it
  also decides which origins may open a WebSocket.
* Fixed a project with a background job failing to build and test: the job's test imported `./config` instead of
  `../config` and left its test bodies empty, which the project's lint rejects. It now tests the job's schedule,
  `start()`, `run()` and `stop()`.
* `model` adds a new datastore to `test/config.ts` as well as `src/config.ts` (in-memory sqlite for SQL, the test
  MongoDB for MongoDB), and only when the model sets one up (the `newDatastore` context value), never for an existing
  one.
