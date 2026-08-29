# Release Notes

## Unreleased

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
