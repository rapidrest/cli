# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.1.0] - 2026-11-05

### Added
- Added generate server --no-db to create a project without databases without prompting

### Changed
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### Fixed
- Fixed package file
- Fixed a new project's test, and so its CI, failing until its first test was generated: the template's Vitest config now passes with no test files
- Fixed CI failing to install dependencies since the bin paths in package.json changed: yarn.lock now matches them

## [3.0.1] - 2026-11-05

### Changed
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### Fixed
- Fixed the published package missing its rapidrest and rr executables: bin/ was ignored by git, so CI never had it to publish
- Fixed the publish job failing because npm ran the pack script with the runner's Yarn 1: the pack steps now run under the pinned Yarn and npm publish skips scripts

## [3.0.0] - 2026-11-05

### Added
- Added the missing "Enable corepack" step to the validate job - every other job already has it, and without it yarn runs the container's stock Yarn 1 instead of the packageManager-pinned version, which refuses to run at all against a packageManager field, so validate's yarn npm audit never actually ran regardless of real findings. Confirmed via a real CI failure on rapidmx/server and rapidrest/auth-server; same latent gap across the whole org's shared workflow template
- Added the rule that the more specific agent model assignment wins where categories overlap
- Added a --router flag (and prompt) to generate react for @rapidrest/react's client-side navigation, building the routed apps' router entries in vite.config.ts
- Added an AuthElevationRoute (/auth/elevation) to generate auth, without which no @RequiresElevation action (changing secrets, managing users, the admin restart/clear-cache endpoints) could ever be performed
- Added @rapidrest/auth's SystemSettings model to the generated auth models
- Added templates/templates.json, which declares the templates' version, the template engine they need and the @rapidrest majors they target
- Added template resolution: the newest compatible templates release is downloaded, verified against its SHA-256 and cached in ~/.rapidrest/templates, with the cached copy used offline
- Added a --templates flag (and RAPIDREST_TEMPLATES) to every command that renders templates, taking a templates version or a local templates directory or zip
- Added upgrade --latest to move a project to the newest templates major, and recording the templates version applied in package.json
- Added yarn release templates <bump> and a Templates workflow that publishes a templates release from its tag's green Build
- Added a new datastore to test/config.ts as well as src/config.ts (in-memory sqlite for SQL, the test MongoDB for MongoDB), and only when generate model sets one up
- Added a flag for every generate prompt so the commands can run unattended: --no-cache, --no-protect, --no-properties, --datastore-type and --[no-]update-docker/--[no-]update-k8s on model, --no-api and --no-protect on route, --no-router and --no-hydrate on react, and --no-service on react-page
- Added --oidc-client-id, --oidc-credentials-from-env (leave client secrets empty in config.ts for the environment to supply) and --oidc-custom-* endpoint flags to generate auth

### Changed
- Document that a downstream package's release bump level follows its upstream dependency's, minor for minor, patch for patch and major for major, in NOTES
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Publish a prerelease version to npm under the next tag, which npm requires, and a release under latest
- Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
- Publish only from a release tag's own Build, and only once every Build of that commit has finished green
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Record the standing agent model assignments in the project notes
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Move the agent model assignments to the top of the project notes, keeping session history at the bottom
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Update the agent model assignments to JP's revised criteria: Sonnet for general code and review, Opus for architecture, planning, investigation, security and performance, Haiku for simple operations
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Updated the templates to @rapidrest/core 6.1, @rapidrest/service-core 2.5.1, @rapidrest/auth 2.0 and @rapidrest/react 2.3
- Updated the README and project notes
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Releasing the templates separately from the CLI, as GitHub releases of this repository tagged templates-v<version>, so templates and their dependency versions can change without a CLI release
- Keeping existing projects on compatible templates: inside a project, only templates from the major it was scaffolded with and matching its installed @rapidrest versions are used
- Resolving template dependency ranges written as ^<major> to the newest matching release when scaffolding
- Recording the templates version in a new project's package.json, with its @rapidrest/cli devDependency set to the CLI that scaffolded it
- Updated the README with how templates are delivered and versioned
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Updated handlebars to 4.7.10, undici to 8.12.3 and the transitive brace-expansion, follow-redirects and undici 6 to versions without known high-severity advisories
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Updated pinned deps
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
- Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>

### Fixed
- Fixed issue with dot-prefixed files being excluded in templates during npm packaging
- Fixed generate react-page --service writing a @ReactService path @rapidrest/react 2.x never registers, so the page got none of its service's props; the path is now the page's public URL under the app's mount path
- Fixed generate auth copying the nested oidc-provider template into every project
- Fixed generated projects' tests failing to start the server: the auth method, OIDC provider and React manifest settings are now added to test/config.ts as well as src/config.ts, with an in-memory test datastore for auth
- Fixed the generated CORS allow-list being ignored: the config key is cors.origins, not cors.origin, and since service-core 2.5 it also drives the WebSocket Origin check
- Fixed the release script's changelog range picking up a templates tag as the previous CLI release
- Fixed CI failing with "corepack: not found" on Node 25 and later, which no longer bundle corepack: every workflow now installs it before enabling it
- Fixed generated projects' GitHub and GitLab CI and Dockerfile failing the same way on the current node:lts images
- Fixed CI running Yarn 1 against the Yarn 4 lockfile, which failed every Build at installing dependencies and stopped the validate job's audit from running: Yarn is now pinned with packageManager yarn@4.12.0
- Fixed the CI test job: installing git for the release tests, and running the tests as the image's unprivileged node user, since embedded Postgres refuses to run as root
- Fixed a project with a background job failing to build and test: the generated job test imported ./config instead of ../config and left its test bodies empty, which the project's lint rejects; it now tests the job's schedule, start(), run() and stop()
- Fixed generate model --datastore with a name that isn't configured writing an empty, type-less datastore block the server can't start with: it now sets up a new datastore of that name, asking for its type or taking the new --datastore-type flag, and rejects names that aren't identifiers
- Fixed generate model not offering to update the Docker and Helm files after setting up a project's first datastore
- Fixed entries added to a nested config.ts block being indented one level too shallow and pushing the block's closing brace to column 0
- Fixed generate model, route, job and react reporting the project directory instead of the generated file's path, and their --output-dir help describing a src/ directory
- Fixed a custom OIDC provider's default scopes being written as the single scope "openid email profile"
- Fixed generate auth's --sql-type example and its help still listing account elevation as not scaffolded

### Removed
- Removed the templates from the npm package

## [2.1.0] - 2026-09-15

### Changed
- Test comment and formatting preservation, lock-step README versions, CRLF files, missing keys and values that can't be edited in place
- Document the fix in the README, release notes and NOTES
- Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

### Fixed
- Fixed release stripping every comment from a Helm chart's values.yaml and Chart.yaml by setting service.image.tag and appVersion through setYamlScalar, which rewrites only that line, keeps its quoting, trailing comment and line endings, and parses the result to confirm the value before writing
- Fixed release rewriting every version-like string in README.md, which turned 127.0.0.1 into the new version and would change sibling projects released at the same version, by updating only the Docker Image table's Tag row and the --version of the project's own chart reference through updateReadmeVersion
- Fixed release rewriting other *_VERSION= assignments in single_node_install.sh by updating only the VERSION= line, keeping its quoting

## [2.0.0] - 2026-09-11

### Added
- Added changelog/contributors files to server template

### Changed
- Updated react and server templates
- Dev command now sets NODE_ENV to "development"
- Release command now ignores certain git commit message trailers
- Updated tsconfig.tsbuildinfo

### Fixed
- Fixed clean issue with react export command
- Fixed CI workflows
- Fixed linter errors
- Fixed multiple issues with process management that caused zombie processes to be left running after killing a `dev` or `start` command

### Removed
- Removed unused auth/login from react template

## [1.0.1] - 2026-08-29

### Fixed
- Fixed badges in readme
- Fixed react template to add missing manifestPath to config.ts

## [1.0.0] - 2026-08-29

### Added
- Added linter step to `build` command
- Added missing classloader configuration for react template
- Added react case to doctor command

### Changed
- `dep upgrade` no longer displays 'already up to date' as warnings
- Updated k3s_install.sh script in helm template
- Replacing postversion.js script with new release.ts script
- Updated readme and release notes
- Replacing all uses of child_process with cross-spawn. This fixes multiple issues with running commands in a Windows environment
- Upgraded all template dependencies to latest
- Release script now stages any changed file

### Fixed
- Fixed base_path resolution in server template
- Fixed duplicate import in server template
- Fixed broken flag shortcuts


## [0.19.0] - 2026-08-28

### Added
- Added `rapidrest doctor` command for diagnosing project issues
- Added `rapidrest upgrade` command
- Added `generate auth` command, with selectable authentication methods, MFA, and OIDC provider presets
- Added a `generate react export` command
- Added a new `release` command for performing project releases (updates changelog, release notes, package version, and git tag)
- Added a new `dep` command with `add`/`install`/`remove`/`upgrade` subcommands, the latter for upgrading the entire dependency set to latest versions (not just semver bumps)
- Added a new `test` command
- `generate model` now supports real, typed property definitions
- `generate server` now supports a full non-interactive mode via flags and an `--answers` file
- Added a contribution guide

### Changed
- Migrated the project license from MIT to MPL-2.0
- Scaffold commands now run `npm`/`yarn install` automatically
- `dev`/`start` commands now import `config.ts` instead of parsing the file directly
- `build` command now calls `tsc` and `vite` directly
- Upgraded dependencies and updated templates to match
- Updated the server template's dependency versions
- Updated the docker/helm templates
- Updated the react/docker templates

### Fixed
- Fixed SQL datastore support and template-generation correctness bugs
- Fixed bugs with react/docker support
- Removed a redundant copy step from the Dockerfile template

## [0.18.0] - 2026-07-14

### Added
- `dev --bun` and `start --bun` now check the local system for a compatible Bun version, downloading it if needed

## [0.17.0] - 2026-07-14

### Added
- Added automatic port detection and selection of an alternative port when the default port is already in use for `dev`/`start` commands
- Added unit tests for the dynamic port feature
- Brought the test suite to 100% coverage across statements, branches, functions, and lines

### Changed
- Updated the docker template files
- Updated the server ESLint config
- Specifying `--port` for `dev`/`start` now fails if the port is already in use

### Fixed
- Fixed multiple issues with docker builds and the CI workflow

## [0.16.1] - 2026-07-11

### Removed
- Removed the `docker` flag from `build`

## [0.16.0] - 2026-07-11

### Changed
- Upgraded `@rapidrest` dependencies in templates
- `start --docker` no longer performs a build

## [0.15.0] - 2026-07-10

### Changed
- Updated react and service-core dependencies

## [0.14.0] - 2026-07-10

### Added
- Added support for generating a `BaseStaticRoute` to the `generate default-route` command
- Added `ioredis-mock` and updated test templates
- Added the missing `className` template variable to the test base context

### Changed
- Updated the react dependency in the react template
- Updated the service-core dependency in the server template
- React template now patches `tsconfig.ts`

### Fixed
- Fixed `MetricsCollector` in the server template
- Fixed the API version prompt
- Fixed `@Route` path in the react template
- Fixed an issue with the react template
- Removed an unused import

## [0.13.0] - 2026-07-10

### Changed
- React route class now takes the app name

## [0.12.0] - 2026-07-10

### Added
- Added a new `generate default-route` command for generating default routes
- Added an `api` flag to `generate route`/`generate server` for toggling between `@Route` and `@ApiRoute`
- Added the missing `--author` flag to `generate server`

### Changed
- Upgraded the server template to service-core `1.0.0-rc.17`
- Updated all affected templates
- Updated the readme with all recent changes

### Removed
- Removed react files from the server template

## [0.11.1] - 2026-07-09

### Fixed
- Fixed an issue with the `ACLRoute` template
- Fixed an import issue with the `ACLRoute` template
- Fixed a condition in the server template

## [0.11.0] - 2026-07-09

### Added
- Added `ACLRoute` to the server template

## [0.10.1] - 2026-07-09

### Changed
- Updated the server template

## [0.10.0] - 2026-07-09

### Added
- Added built-in system routes to the server template

## [0.9.0] - 2026-07-09

### Added
- Added a `validate` script

### Changed
- Updated templates with the latest changes to service-core
- Updated the server template's dependency versions
- Updated the job template

### Fixed
- Fixed the server template's `tsconfig`
- Fixed service-core test imports
- Fixed a route test template error

## [0.8.0] - 2026-07-05

### Changed
- Updated the server template with the latest service-core release
- Route/server templates now use `CRUDRoute` instead of `ModelRoute`

## [0.7.0] - 2026-07-02

### Added
- Added a `generate job` command
- Added a new `GenerateReactPage` command; it can accept paths for the name and generates accordingly

### Changed
- `GenerateModel` cache flag now allows setting a TTL
- Updated the route template
- Updated the readme

### Fixed
- Fixed linter errors

## [0.6.0] - 2026-06-30

### Added
- `dev`/`start` commands can now run in Docker via a new `docker` flag

### Changed
- Moved docker support to its own `generate` subcommand
- Moved the k8s (helm) feature to its own subcommand
- Generator commands now detect the author from the system git configuration
- Converted y/n select prompts to use confirm prompts
- `GenerateModel` now runs the docker and helm commands when a new datastore is created
- `GenerateServer` now runs `GenerateReact` when selected
- Updated the readme to reflect all recent changes

### Fixed
- Fixed issues with `GenerateReact`
- Fixed react/helm template configs
- Fixed templates and commands that assumed a yarn package manager
- Fixed missing imports

## [0.5.0] - 2026-06-30

### Added
- Added automatic version updates
- Added full template integration tests to validate generator output

### Fixed
- Fixed incorrect `#eq` syntax in templates

## [0.4.0] - 2026-06-30

### Added
- Users can now opt to create a new datastore when generating models
- Added `--none--` as an SCM option; Redis is now selected by default

### Fixed
- Fixed template issues
- Updated the template dependency

## [0.3.0] - 2026-06-30

### Added
- Added several configuration options for `generate model` and `generate route` commands
- `generate route` can now create models too
- Added support for patch files to the template system, hooked up to the new datastore configuration
- `generate model` and `generate route` now patch projects for cache/RBAC configuration when enabled
- Added a `generate react` command
- `generate route` always produces a test file

### Changed
- `generate model` no longer assumes a single template file/destination

## [0.2.3] - 2026-06-30

### Fixed
- Fixed a missing type override for datastore environment variables

## [0.2.2] - 2026-06-30

### Fixed
- Fixed issues with server path detection
- Fixed a shell issue on Windows

## [0.2.1] - 2026-06-30

### Added
- Added unit tests for `dev`/`start` commands

### Changed
- Updated log output

### Fixed
- Fixed runtime errors with `tsx`

## [0.2.0] - 2026-06-30

### Added
- Initial release of the `rapidrest` CLI
- Added `rr` as a bin alias
- `dev`/`start` commands now spawn database servers directly, without requiring a project dependency

### Changed
- `build` command now detects the package manager
- Updated the server template

### Fixed
- Fixed the postversion step
- Fixed imports
- Fixed tests and a bug with Redis

[Unreleased]: https://github.com/rapidrest/cli/compare/v3.1.0...HEAD
[3.1.0]: https://github.com/rapidrest/cli/compare/v3.0.1...v3.1.0
[3.0.1]: rapidrest/cli/compare/v3.0.0...v3.0.1
[3.0.0]: rapidrest/cli/compare/v2.1.0...v3.0.0
[2.1.0]: rapidrest/cli/compare/v2.0.0...v2.1.0
[2.0.0]: rapidrest/cli/compare/v1.0.1...v2.0.0
[1.0.1]: rapidrest/cli/compare/v1.0.0...v1.0.1
[1.0.0]: rapidrest/cli/compare/v0.19.0...v1.0.0
[0.19.0]: https://github.com/rapidrest/cli/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/rapidrest/cli/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/rapidrest/cli/compare/v0.16.1...v0.17.0
[0.16.1]: https://github.com/rapidrest/cli/compare/v0.16.0...v0.16.1
[0.16.0]: https://github.com/rapidrest/cli/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/rapidrest/cli/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/rapidrest/cli/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/rapidrest/cli/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/rapidrest/cli/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/rapidrest/cli/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/rapidrest/cli/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/rapidrest/cli/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/rapidrest/cli/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/rapidrest/cli/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/rapidrest/cli/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/rapidrest/cli/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/rapidrest/cli/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/rapidrest/cli/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/rapidrest/cli/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rapidrest/cli/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/rapidrest/cli/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/rapidrest/cli/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/rapidrest/cli/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rapidrest/cli/commit/e8fc328203c89891098f7ccfccf330a6b0d6f6ad
