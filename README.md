# rapidrest

The official CLI tool for [RapidREST](https://github.com/rapidrest) projects.

[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/rapidrest.svg)](https://npmjs.org/package/rapidrest)
[![License](https://img.shields.io/npm/l/rapidrest.svg)](https://github.com/rapidrest/cli/blob/main/package.json)

---

## Overview

`rapidrest` is a CLI that scaffolds and manages RapidREST server projects. It handles the full project lifecycle:

- **Scaffold** a new server project with your choice of databases, frontend, and deployment targets
- **Generate** model and route files inside an existing project
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

---

## Quick Start

```sh
# 1. Scaffold a new project
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
  --force              Overwrite existing files
```

The command walks through an interactive prompt to configure the generated project:

| Prompt | Options |
|--------|---------|
| Project description | Free text |
| Package manager | `yarn` \| `npm` |
| Databases | `MongoDB`, `PostgreSQL`, `Redis`, `SQLite` (multi-select) |
| Additional features | `React`, `Docker`, `Kubernetes / Helm`, `Electron` (multi-select) |
| Source control | `GitHub`, `GitLab`, `Git`, `Perforce`, `SVN` |

**What gets generated depends on your selections.** Files and configuration blocks for unselected features are omitted entirely — for example, selecting only MongoDB means no PostgreSQL config, no Dockerfile, no Helm chart.

**Database notes:**
- When any persistent database is configured (MongoDB, PostgreSQL, or SQLite), the ACL datastore and RBAC system are enabled automatically. MongoDB is always preferred for ACL if selected; otherwise PostgreSQL, then SQLite.
- Redis is supported as a cache/event bus but does not serve as an ACL store.
- When no persistent database is selected, the ACL datastore is omitted and `rbac.enabled` is set to `false`.

**React note:** Selecting React adds a [Vite](https://vitejs.dev/) config and `@rapidrest/react` to the project. The `dev` and `start` commands detect this and automatically include Vite in the build/watch pipeline.

**Kubernetes note:** Selecting `Kubernetes / Helm` generates a Helm chart under `helm/`. The chart uses `[[ ]]` delimiters for RapidREST template variables so that Helm's own `{{ }}` Go-template expressions are preserved untouched.

**Example:**

```sh
rapidrest generate server my-api
# → prompts for all options, then writes my-api/ with the selected features
```

---

### `rapidrest generate model NAME`

Generate a RapidREST model class inside the current project.

```
USAGE
  $ rapidrest generate model NAME [--output-dir <path>] [--force]

ARGUMENTS
  NAME  Name of the model class (e.g. Product, UserProfile)

FLAGS
  --output-dir <path>  Directory to write the generated model into. Defaults to ./src/models
  --force              Overwrite existing files
```

Prompts for a description and the datastore name (e.g. `mongo`, `postgres`). The `author` field is read automatically from the project's `package.json`; the prompt is skipped if it is found.

Writes `<output-dir>/<NAME>.ts`.

**Example:**

```sh
rapidrest generate model Product
# → creates src/models/Product.ts
```

---

### `rapidrest generate route NAME`

Generate a RapidREST route handler inside the current project.

```
USAGE
  $ rapidrest generate route NAME [--output-dir <path>] [--no-test] [--force]

ARGUMENTS
  NAME  Name of the route class (e.g. ProductRoute, AuthRoute)

FLAGS
  --output-dir <path>  Directory to write the generated route into. Defaults to ./src/routes
  --no-test            Skip generating the test file
  --force              Overwrite existing files
```

Prompts for a description and the base route path (e.g. `/api/v1/products`). The `author` field is read automatically from `package.json` if present. By default a matching test file is also created under `./test/`.

**Example:**

```sh
rapidrest generate route ProductRoute
# → creates src/routes/ProductRoute.ts and test/ProductRoute.test.ts
```

---

### `rapidrest dev`

Start the RapidREST server in development mode with hot reloading.

```
USAGE
  $ rapidrest dev [--inspect]

FLAGS
  --inspect  Enable the Node.js inspector on port 9229 for debugger attachment
```

Run this command from the root of a generated RapidREST project. It:

1. Reads `src/config.ts` to detect which databases are configured.
2. Starts any required databases:
   - **MongoDB** — launched in-process via `mongodb-memory-server` (no install required).
   - **PostgreSQL / Redis** — probed via TCP; assumed to be already running locally.
3. Starts the server via **nodemon + tsx** watching `src/` for TypeScript and JSON changes.
4. If the project has a `vite.config.ts` (i.e. React was selected at generate time), also starts **`vite build --watch`** concurrently.

All child processes are cleaned up on `CTRL+C`.

**Example:**

```sh
cd my-api
rapidrest dev
rapidrest dev --inspect   # attach a debugger on localhost:9229
```

---

### `rapidrest start`

Build and start the RapidREST server for production.

```
USAGE
  $ rapidrest start [--no-build]

FLAGS
  --no-build  Skip the build step
```

Run this command from the root of a generated RapidREST project. It:

1. Runs `yarn build` or `npm run build` (auto-detected from `yarn.lock` / `package.json`).
2. If the project has a `vite.config.ts`, also runs `vite build` to compile the React frontend.
3. Reads `src/config.ts` to detect which databases are configured and starts them (same logic as `dev`).
4. Starts the compiled server with `node dist/server.js`.

**Example:**

```sh
cd my-api
rapidrest start
rapidrest start --no-build   # skip build, just start databases + server
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

## Template system

The built-in templates use [Handlebars](https://handlebarsjs.com/) for variable substitution and conditional blocks. A `template.config.json` manifest in each template controls whole-file conditional inclusion (e.g. `Dockerfile` is only emitted when `features.docker` is `true`).

Helm chart templates are a special case: they use `[[ ]]` delimiters for RapidREST substitutions while leaving Helm's `{{ }}` Go-template syntax completely untouched.

---

## Contributing

```sh
git clone https://github.com/rapidrest/cli
cd cli
yarn install
yarn build
yarn test
```
