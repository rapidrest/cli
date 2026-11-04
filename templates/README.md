# RapidREST templates

The files `rapidrest generate`, `upgrade` and `doctor` render. They are versioned and released on their own, as
GitHub releases of this repository tagged `templates-v<version>`, so they can change without a CLI release. The CLI
downloads the release it needs and caches it in `~/.rapidrest/templates/<version>/`. A source checkout of the CLI
renders this directory directly, so changes can be tried before they are released.

## templates.json

```json
{
  "version": "1.0.0",
  "engine": "^1.0.0",
  "targets": { "@rapidrest/core": "6.x", "@rapidrest/service-core": "2.x" }
}
```

- `version`: these templates' version.
- `engine`: the range of the CLI's template engine (`TEMPLATE_ENGINE_VERSION` in `src/lib/templateSource.ts`) these
  templates need. A CLI outside the range never uses them.
- `targets`: the `@rapidrest` package majors the generated code is written for. Inside an existing project, the CLI
  only uses templates whose targets match the project's installed packages, and only from the templates major the
  project was scaffolded with (`rapidrest.templates` in its package.json). `rapidrest upgrade --latest` is the
  deliberate way to a newer major.

## Versioning

- **Major**: the targeted `@rapidrest` majors change, or generated code changes in a way that doesn't fit projects
  scaffolded from the previous major.
- **Minor**: new templates, options or features that work in existing projects.
- **Patch**: fixes, and dependency changes within the same majors.

Since projects only ever receive releases from their own major, a fix needed by an older major is released from a
branch of that major.

## The engine contract

What templates may rely on from the CLI, and what bumps `TEMPLATE_ENGINE_VERSION` when it changes (minor for
additions, major for anything else):

- `template.config.json`: `conditionalFiles`, `helmPaths` and `patches` (`ts-block-insert`, `ts-property-set` and
  `json-merge`, with `condition` and `idempotencyKey`).
- Handlebars with `noEscape`, the `eq` and `isUndefined` helpers, and `[[ ]]` substitution under `helmPaths`.
- `_gitignore`, `_npmignore` and `_npmrc` are written as `.gitignore`, `.npmignore` and `.npmrc`.
- A subdirectory with its own `template.config.json` is a separate template (e.g. `auth/oidc-provider`).
- The context each generator passes (see each `src/commands/generate/*.ts`), including `templatesVersion` and
  `cliVersion` for `server`.
- Dependency ranges written as `^<major>` (or `^0.<minor>`) in any package.json a template writes or merges are
  resolved to the newest matching published version when scaffolding. Any other range is written as is.

## Releasing

1. Add the changes under `## Unreleased` in `RELEASE_NOTES.md`.
2. Run `yarn release templates <major|minor|patch>` from the repository root. It bumps `templates.json`, moves the
   release notes under the new version, commits, tags `templates-v<version>` and pushes.
3. The tag's Build runs the tests; the Templates workflow then publishes the release (a zip of this directory made
   with `git archive`, plus `templates.json` with the zip's SHA-256).
