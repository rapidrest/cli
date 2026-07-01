# rapidrest

The official CLI tool for [RapidREST](https://github.com/rapidrest) projects.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/rapidrest.svg)](https://npmjs.com/package/@rapidrest/cli)
[![License](https://img.shields.io/npm/l/rapidrest.svg)](https://github.com/rapidrest/cli/blob/main/package.json)

---

## Overview

`rapidrest` scaffolds and manages RapidREST server projects. It handles the full project lifecycle:

- **Scaffold** a new server project with your choice of databases, frontend, and deployment targets
- **Generate** models, routes, and add-on support (Docker, Kubernetes, React) inside an existing project
- **Develop** with hot-reload and automatic in-memory database startup
- **Build and start** the compiled server in one command

---

## Installation

```sh
npm install -g @rapidrest/cli
# or
yarn global add @rapidrest/cli
```

Requires Node.js 18 or later.

Once installed, the CLI is available as both `rapidrest` and the shorter alias `rr`. Every example below works with either name.

---

## Quick Start

```sh
# 1. Scaffold a new project (interactive prompts guide you through the options)
rapidrest generate server my-api

# 2. Install dependencies
cd my-api && yarn install

# 3. Start the development server
rapidrest dev
```

---

## Commands

- [`rapidrest generate server NAME`](#rapidrest-generate-server-name)
- [`rapidrest generate model NAME`](#rapidrest-generate-model-name)
- [`rapidrest generate route NAME`](#rapidrest-generate-route-name)
- [`rapidrest generate docker`](#rapidrest-generate-docker)
- [`rapidrest generate k8s`](#rapidrest-generate-k8s)
- [`rapidrest generate react NAME`](#rapidrest-generate-react-name)
- [`rapidrest dev`](#rapidrest-dev)
- [`rapidrest start`](#rapidrest-start)
- [`rapidrest build`](#rapidrest-build)

---

### `rapidrest generate server NAME`

Scaffold a new RapidREST server project from the built-in template.

```
USAGE
  $ rapidrest generate server NAME [--output-dir <path>] [--force]

ARGUMENTS
  NAME  Name of the new project (also used as the output directory name)

FLAGS
  --output-dir <path>  Directory to write the generated project into. Defaults to ./<NAME>
  --force               Overwrite existing files
```

The command walks through an interactive prompt to configure the generated project:

| Prompt | Options |
|--------|---------|
| Project description | Free text |
| Author | Auto-filled from your Git config when available; otherwise you're prompted |
| Package manager | `yarn` \| `npm` |
| Databases | `MongoDB` (checked), `PostgreSQL`, `Redis` (checked), `SQLite` (multi-select) |
| Additional features | `React`, `Docker` (checked), `Kubernetes (Helm)` (multi-select) |
| Source control | `GitHub`, `GitLab`, `Git`, `Perforce (Helix)`, `Subversion`, or none |

**What gets generated depends on your selections.** Files and configuration blocks for unselected features are omitted entirely — for example, selecting only MongoDB means no PostgreSQL config, no Dockerfile, no Helm chart.

If you select **Docker**, **Kubernetes (Helm)**, or **React**, `generate server` automatically runs `generate docker`, `generate k8s`, and/or `generate react` against the newly created project right after scaffolding it, so the add-on files are already in place — you don't need to run those commands separately.

**Example:**

```sh
rapidrest generate server my-api
# → prompts for all options, then writes my-api/ with the selected features

rapidrest generate server my-api --output-dir ~/projects/my-api
```

---

### `rapidrest generate model NAME`

Generate a RapidREST model class inside the current project.

```
USAGE
  $ rapidrest generate model NAME [--output-dir <path>] [--author <name>] [--description <text>]
      [--datastore <name>] [--cache] [--protect] [--force]

ARGUMENTS
  NAME  Name of the model class (e.g. Product, UserProfile)

FLAGS
  -o, --output-dir <path>    Directory to write the generated model into. Defaults to ./src/models
  -a, --author <name>        Author to attribute the generated code to
  -d, --description <text>   Short description of the model
  -ds, --datastore <name>    Name of the datastore the model will be bound to
  -c, --cache                Enable caching for this model
  -p, --protect              Enable RBAC-based protection for this model
  -f, --force                Overwrite existing files
```

Any flag you omit is instead asked for interactively:

- **Datastore** — if the project already has datastores configured, you pick one from a list (or choose "+ New datastore..." to configure MongoDB, PostgreSQL, or SQLite on the fly). If the project has no datastores yet, you're offered to set one up.
- **Cache** and **Protect (RBAC)** — confirmed with a yes/no prompt (both default to enabled).
- **Author** — read automatically from your Git config or the project's `package.json` when available; you're only prompted if neither is found.

If you configure a brand-new datastore while generating the model, and the project already has Docker and/or Kubernetes (Helm) support, you'll be asked whether to regenerate those files so they pick up the new datastore (this overwrites the existing Docker/Helm files).

Writes `<output-dir>/<NAME>.ts`.

**Example:**

```sh
rapidrest generate model Product
# → creates src/models/Product.ts

rapidrest generate model Product --datastore mongo --cache --protect
```

---

### `rapidrest generate route NAME`

Generate a RapidREST route handler inside the current project.

```
USAGE
  $ rapidrest generate route NAME [--output-dir <path>] [--author <name>] [--description <text>]
      [--path <route-path>] [--model <name>] [--no-model] [--protect] [--no-test] [--force]

ARGUMENTS
  NAME  Name of the route class (e.g. ProductRoute, AuthRoute)

FLAGS
  --output-dir <path>       Directory to write the generated route into. Defaults to ./src/routes
  -a, --author <name>       Author to attribute the generated code to
  -d, --description <text>  Short description of the route
  --path <route-path>       Base path of the route (e.g. /api/v1/products)
  -m, --model <name>        Name of the model class this route will serve (extends ModelRoute)
  --no-model                Skip all prompts about associating a model class
  -p, --protect             Enable RBAC-based protection for this route
  --no-test                 Skip generating the matching test file
  -f, --force                Overwrite existing files
```

Unless `--model` or `--no-model` is passed, you're offered a list of the project's existing models to bind the route to (or "+ New model..." to run `generate model` inline without leaving the prompt). If the project has no models yet, you can type a model name directly.

By default a matching test file is also created under `./test/`.

**Example:**

```sh
rapidrest generate route ProductRoute
# → creates src/routes/ProductRoute.ts and test/ProductRoute.test.ts

rapidrest generate route ProductRoute --model Product --protect --no-test
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

Inspects the project's configured datastores and generates a `Dockerfile`, `docker-compose.yml`, and supporting scripts tailored to whichever of MongoDB, PostgreSQL, and Redis are in use. This is the same step `generate server` runs automatically when you select Docker at scaffold time — run it directly when you want to add Docker support later, or to regenerate it after adding a new datastore.

**Example:**

```sh
cd my-api
rapidrest generate docker
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

Generates a Helm chart under `helm/`, tailored to the project's configured datastores. The chart templates use `[[ ]]` delimiters for RapidREST template variables, so Helm's own `{{ }}` Go-template expressions are preserved untouched.

Like `generate docker`, this runs automatically from `generate server` when Kubernetes (Helm) is selected — run it directly to add the chart later or regenerate it after adding a new datastore.

**Example:**

```sh
cd my-api
rapidrest generate k8s
```

---

### `rapidrest generate react NAME`

Add a RapidREST-managed React frontend to the current project.

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

Adds a [Vite](https://vitejs.dev/)-based React app under `app/`, wires it into the project's routing, and adds `@rapidrest/react` as a dependency. Once configured, the `dev` and `start` commands automatically detect the frontend and include Vite in the build/watch pipeline.

**Example:**

```sh
cd my-api
rapidrest generate react app
rapidrest generate react app --path /dashboard --hydrate
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
