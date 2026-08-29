# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: rapidrest/cli/compare/v1.0.1...HEAD
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
