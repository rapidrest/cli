# rapidrest

The official CLI tool for [RapidREST](https://github.com/rapidrest) projects.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/rapidrest.svg)](https://npmjs.com/package/@rapidrest/cli)
[![License](https://img.shields.io/npm/l/rapidrest.svg)](https://github.com/rapidrest/cli/blob/main/package.json)

---

## Overview

`rapidrest` scaffolds and manages RapidREST server projects. It handles the full project lifecycle:

- **Scaffold** a new server project with your choice of databases, frontend, and deployment targets
- **Generate** models, routes, background jobs and add-on support (Docker, Kubernetes, React) inside an existing project
- **Develop** with hot-reload and automatic in-memory database startup
- **Build and start** the compiled server in one command

---

## Installation

```sh
npm install -g @rapidrest/cli
# or
yarn global add @rapidrest/cli
```

RapidREST requires Node.js LTS (24) or later.

Once installed, the CLI is available as both `rapidrest` and the shorter alias `rr`. Every example below works with either name.

---

## Quick Start

```sh
# 1. Scaffold a new project (interactive prompts guide you through the options)
rapidrest generate server my-api

# 2. Install dependencies
cd my-api && yarn install

# 3. Create a new route
rapidrest generate route MyRoute

# 4. Start the development server
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
- [`rapidrest dev`](#rapidrest-dev)
- [`rapidrest start`](#rapidrest-start)
- [`rapidrest build`](#rapidrest-build)

---

### `rapidrest generate server NAME`

Scaffold a new RapidREST server project.

```
USAGE
  $ rapidrest generate server NAME [--output-dir <path>] [--author <name>] [--force]

ARGUMENTS
  NAME  Name of the new project (also used as the output directory name)

FLAGS
  --output-dir <path>  Directory to write the generated project into. Defaults to ./<NAME>
  -a, --author <name>  Author to attribute the generated code to
  --force               Overwrite existing files
```

The command walks through an interactive prompt to configure the generated project:

| Prompt | Description | Options |
|--------|---------|
| Project description | Textual description of your project | Free input |
| Author | The author of the project (skipped if `--author` is passed) | Auto-filled from your Git config when available; otherwise you're prompted |
| Package manager | The desired Node.js package manager | `yarn` \| `npm` |
| Databases | Desired database(s) to use in the project | `MongoDB` , `PostgreSQL`, `Redis` , `SQLite` |
| Additional features | Additional RapidREST features to enable | Default routes (`ACL`, `Admin`, `Metrics`, `OpenAPI`, `Push`, `Status` — all checked by default), `React`, `Docker`, `Kubernetes (Helm)` (multi-select) |
| API prefix | Whether to prefix all non-React routes with `/api` | Yes/No, then optionally a version (e.g. `1` → `/api/v1`) |
| Source control | The SCM to use for the project | `GitHub`, `GitLab`, `Git`, `Perforce (Helix)`, `Subversion`, or none |

Any default routes selected above are generated via [`generate default-route`](#rapidrest-generate-default-route) immediately after the project is scaffolded, using the same author and API prefix you chose here.

**Example:**

```sh
rapidrest generate server my-api
# → prompts for all options, then writes my-api/ with the selected features

rapidrest generate server my-api --output-dir ~/projects/my-api
rapidrest generate server my-api --author "Jane Doe <jane@example.com>"
```

---

### `rapidrest generate model NAME`

Generate a new data model class inside the current project.

```
USAGE
  $ rapidrest generate model NAME [--output-dir <path>] [--author <name>] [--description <text>]
      [--datastore <name>] [--cache [ttl]] [--protect] [--force]

ARGUMENTS
  NAME  Name of the data model class (e.g. Product, UserProfile)

FLAGS
  -o, --output-dir <path>    Directory to write the generated model into. Defaults to ./src/models
  -a, --author <name>        Author to attribute the generated code to
  -d, --description <text>   Short description of the model
  -ds, --datastore <name>    Name of the datastore the model will be bound to
  -c, --cache [ttl]          Cache TTL (in seconds) for this model
  -p, --protect              Enable RBAC-based protection for this model
  -f, --force                Overwrite existing files
```

If the project does not contain an existing datastore, or you simply want to want to set up a different datastore than previously configured, this command will help you create a new one.

`--cache` has three forms:

- Omitted entirely — you're asked whether to enable caching; if you confirm, you're then prompted for a TTL (default `60`)
- Passed with no value (`--cache`) — caching is enabled with the default TTL of `60` seconds
- Passed with a value (`--cache 120`) — caching is enabled with that TTL in seconds

**Example:**

```sh
rapidrest generate model Product
# → creates src/models/Product.ts

rapidrest generate model Product --datastore mongo --cache 120 --protect
```

---

### `rapidrest generate route NAME`

Generate a new route handler inside the current project.

```
USAGE
  $ rapidrest generate route NAME [--output-dir <path>] [--author <name>] [--description <text>]
      [--path <route-path>] [--api <version>] [--model <name>] [--no-model] [--protect] [--no-test] [--force]

ARGUMENTS
  NAME  Name of the route class (e.g. ProductRoute, AuthRoute)

FLAGS
  --output-dir <path>       Directory to write the generated route into. Defaults to ./src/routes
  -a, --author <name>       Author to attribute the generated code to
  -d, --description <text>  Short description of the route
  --path <route-path>       Base path of the route (e.g. /api/v1/products)
  --api <version>           Use @ApiRoute instead of @Route for the generated route. Pass a version to prefix the
                             path with /api/v<version>; pass an empty value for /api with no version
  -m, --model <name>        Name of the model class this route will serve (extends ModelRoute)
  --no-model                Skip all prompts about associating a model class
  -p, --protect             Enable RBAC-based protection for this route
  --no-test                 Skip generating the matching test file
  -f, --force                Overwrite existing files
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
  $ rapidrest generate default-route [--output-dir <path>] [--author <name>] [--api <version>]
      [--type <type>]... [--static-path <path>] [--force]

FLAGS
  --output-dir <path>    Directory to write the generated route(s) into. Defaults to the current working directory
  -a, --author <name>    Author to attribute the generated code to
  --api <version>        Use @ApiRoute instead of @Route for the generated route(s). Pass a version to prefix paths
                          with /api/v<version>; pass an empty value for /api with no version
  -t, --type <type>      The type of default route to generate: acl, admin, metrics, openapi, push, static, status.
                          Pass more than once to generate multiple route types
  --static-path <path>   Path containing the static files to serve, when the static route is included. Defaults to
                          `public`
  -f, --force             Overwrite existing files
```

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
  $ rapidrest generate job NAME [--output-dir <path>] [--author <name>] [--description <text>]
      [--schedule <cron>] [--force]

ARGUMENTS
  NAME  Name of the background job class (e.g. MetricsCollector, Notificatier)

FLAGS
  -o, --output-dir <path>   Directory to write the generated job into. Defaults to ./src/jobs
  -a, --author <name>       Author to attribute the generated code to
  -d, --description <text>  Short description of the job
  -s, --schedule <cron>     Crontab-style schedule the job runs on (e.g. `* * * * *` runs every minute)
  -f, --force               Overwrite existing files
```

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
  $ rapidrest generate docker [--output-dir <path>] [--force]

FLAGS
  --output-dir <path>  Project directory to add Docker support to. Defaults to the current working directory
  -f, --force          Overwrite existing files
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
  $ rapidrest generate k8s [--output-dir <path>] [--force]

FLAGS
  --output-dir <path>  Project directory to add Kubernetes (Helm) support to. Defaults to the current working directory
  -f, --force          Overwrite existing files
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
  $ rapidrest generate react NAME [--output-dir <path>] [--author <name>] [--path <base-path>]
      [--hydrate] [--force]

ARGUMENTS
  NAME  Name of the React app (e.g. app)

FLAGS
  --output-dir <path>  Project directory to add React support to. Defaults to the current working directory
  -a, --author <name>  Author to attribute the generated code to
  -p, --path <path>    Base path the React application will route to. Defaults to /<NAME>
  --hydrate            Enable client-side hydration (required for interactive apps)
  -f, --force          Overwrite existing files
```

**Example:**

```sh
cd my-api
rapidrest generate react app
rapidrest generate react app --path /dashboard --hydrate
rapidrest dev
```

---

### `rapidrest generate react-page APP NAME`

Add a new page to an existing React app in the current project.

```
USAGE
  $ rapidrest generate react-page APP NAME [--output-dir <path>] [--author <name>] [--service] [--force]

ARGUMENTS
  APP   Name of the React app to add the page to (e.g. app)
  NAME  Name of the page, optionally with a subpath (e.g. Dashboard, my/path/page)

FLAGS
  --output-dir <path>  Project directory to add the page to. Defaults to the current working directory
  -a, --author <name>  Author to attribute the generated code to
  -s, --service        Create a service class for server-side data retrieval for the page
  -f, --force          Overwrite existing files
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

### `rapidrest dev`

Start the RapidREST server in development mode with hot reloading.

```
USAGE
  $ rapidrest dev [--inspect] [--docker]

FLAGS
  --inspect  Enable the Node.js inspector on port 9229 for debugger attachment
  -d, --docker  Run in Docker mode (skips starting in-memory database servers)
```

Run this command from the root of a generated RapidREST project. It:

1. Reads `src/config.ts` to detect which databases are configured.
2. Starts an in-process, in-memory server for each configured database (MongoDB, PostgreSQL, and/or Redis) — no local database installation required. Pass `--docker` to skip this step when your databases are already running elsewhere (e.g. via `docker compose`).
3. Starts the server via `tsx --watch`, watching `src/` for changes.
4. If the project has React support configured (a `vite.config.ts` is present), also starts `vite build --watch` concurrently.

All child processes and started databases are cleaned up on `CTRL+C`.

**Example:**

```sh
cd my-api
rapidrest dev
rapidrest dev --inspect   # attach a debugger on localhost:9229
rapidrest dev --docker    # assume databases are already running (e.g. via Docker Compose)
```

---

### `rapidrest start`

Build and start the RapidREST server for production.

```
USAGE
  $ rapidrest start [--no-build] [--docker]

FLAGS
  --no-build    Skip the build step
  -d, --docker  Run in Docker mode (skips starting in-memory database servers)
```

Run this command from the root of a generated RapidREST project. It:

1. Runs `yarn build` or `npm run build` (auto-detected from `yarn.lock` / `package.json`).
2. If the project has React support configured, also runs `vite build` to compile the frontend.
3. Reads `src/config.ts` to detect which databases are configured and starts an in-memory server for each one — unless `--docker` is passed, in which case this step is skipped.
4. Starts the compiled server (`node dist/server.js`, or the equivalent path for your build output).

**Example:**

```sh
cd my-api
rapidrest start
rapidrest start --no-build   # skip build, just start databases + server
rapidrest start --docker     # assume databases are already running
```

---

### `rapidrest build`

Build the RapidREST server project in the current directory.

```
USAGE
  $ rapidrest build
```

Runs the project's `build` script via the detected package manager. Equivalent to `yarn build` or `npm run build` from the project root.

---

## Regenerating add-ons after project changes

`generate docker` and `generate k8s` are idempotent and safe to re-run with `--force` whenever the project's datastores change — they regenerate their output entirely from the current project state rather than patching existing files. `generate model` will offer to do this for you automatically when you configure a brand-new datastore while adding a model.
