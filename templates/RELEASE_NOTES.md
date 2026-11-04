# Templates Release Notes

The templates are released on their own (tags `templates-v<version>`), separately from the CLI. See README.md.

## Unreleased

## v1.0.0

The first release of the templates on their own, targeting `@rapidrest/core` 6, `@rapidrest/service-core` 2,
`@rapidrest/auth` 2 and `@rapidrest/react` 2. Needs template engine 1 (the first CLI release that downloads its
templates).

* Dependency versions are written as `^<major>` (or `^0.<minor>`) and resolved to the newest matching release when a
  project is scaffolded, so a routine dependency update no longer needs a templates release.
* A new project records the templates version it was scaffolded with in package.json (`rapidrest.templates`), and its
  `@rapidrest/cli` devDependency is the CLI that scaffolded it.
