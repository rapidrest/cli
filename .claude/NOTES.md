# cli — Design Decisions & Session Notes

This file exists so that Claude sessions working in this repo don't re-litigate settled
decisions or re-discover the same issues from scratch. It is local to this repo (not tied to
any one machine's global Claude memory), so it travels with the code.

**Maintenance rule:** when a standing decision changes, update the section below in place
(don't just append a contradiction lower down). When a new investigation/session produces a
decision, finding, or reverted approach worth remembering, add a dated entry under Session Log.
Keep entries terse — this is a reference, not a transcript.

## What this repo is

`@rapidrest/cli` is the scaffolding tool: `generate server`/`generate model`/`generate route`/etc.
render Handlebars templates under `templates/` into a new or existing downstream project. The
templates are consumers of `@rapidrest/core`/`@rapidrest/service-core`/`@rapidrest/react`
(siblings checked out at `../core`, `../service-core`, `../react`, `../auth` on this machine) —
when those libraries' APIs change, the templates silently drift out of sync since nothing in
*this* repo's own test suite actually compiles or runs the generated output against the real
libraries (see the verification-methodology decision below).

## Standing design decisions & constraints

- **Verifying template correctness requires actually scaffolding a project and running its real
  build/lint/test cycle — reading the templates, or running this repo's own `test/` suite, is not
  enough.** `test/lib/template-integration.test.ts` only asserts on rendered *file contents*
  (strings/structure); it never installs dependencies or runs `tsc`/`eslint`/`vitest` against the
  output. A 2026-08-23 session found ~15 real bugs (wrong TypeORM type strings, a decorator given
  the wrong argument count, a TS type keyword used as a runtime value, missing `vitest.config.ts`,
  etc.) that had shipped silently because nothing had ever done this. When changing a template,
  prefer generating into a scratch dir (see Session Log for the harness pattern) and running
  `npm install && npm run build && npm run lint && npm test` for at least one representative
  feature combination before considering the change done, not just re-rendering and eyeballing it.

- **TypeORM's datastore `type` field must be its own driver literal, not the CLI's feature-flag
  name.** `"postgres"` (not `"postgresql"`) and `"better-sqlite3"` (not `"sqlite"`) — see
  `typeorm/driver/types/DatabaseType`. `features.postgresql`/`features.sqlite` (the Handlebars
  context flags driving `{{#if}}` blocks) are named after the *user-facing* choice and are
  completely separate from the string that ends up in `config.ts`'s `datastores.*.type` field —
  don't let the two conflate. Anything that reads a datastore's `type` back out of `config.ts`
  (`db.ts`'s `detectDatabases()`, `generate docker`/`generate k8s`'s `hasPostgres` check, `generate
  model`'s `isPostgreSql`/`isSqlite` flags) must match on the TypeORM literal, not the feature name.

- **`better-sqlite3` datastores still need a `host` field in `config.ts`, even though the driver
  never uses one.** `ConnectionManager.buildConnectionUri()` (service-core) throws unconditionally
  if neither `url` nor `host` is set. Always include a placeholder `host: "localhost"`.

- **Tests for SQL-backed generated projects run against `better-sqlite3`, never a real Postgres
  server, regardless of which SQL feature the project selected.** `test/config.ts` hardcodes
  `type: "better-sqlite3", database: ":memory:"` for every SQL datastore. TypeORM's driver
  abstraction makes the same entities/queries work against either backend, and an in-memory
  database needs no external server and gets a clean slate every run. Don't reintroduce a real
  Postgres dependency (e.g. `postgres-memory-server`) into the generated test suite without a
  specific reason — the mismatch with `src/config.ts` (which does target real postgres/sqlite) is
  intentional.

- **`RouteDecorators.Protect` and `ModelDecorators.Protect` are NOT the same signature.**
  `ModelDecorators.Protect(classACL, recordACL?)` takes two arguments; `RouteDecorators.Protect(acl)`
  takes only one. Both moved from the old boolean-flag `ACLRecord` shape
  (`create`/`read`/`update`/`delete`/`special`/`full`) to `actions: ACLAction[]` at some point
  before this repo's templates were updated to match (2026-08-23) — `special` was dropped
  entirely, with no replacement action. When writing a `@Protect(...)` block, check which
  decorator namespace it's imported from before assuming the two-arg form.

- **`JWTUser` (from `@rapidrest/core`) is exactly `{ uid, roles, scopes, elevated? }` — no `name`
  field.** Passing an object literal with an extra `name` property directly to
  `JWTUtils.createToken()`/`createTokenSync()` is a real `tsc` type error (excess-property check),
  not just unused data. If a human-readable label needs to travel with the token, pass it via the
  third `data?` parameter instead of trying to widen `JWTUser` itself.

- **`nconf`'s `.get()` returns a live reference into its own store, not a copy.** Mutating
  (`delete`, property assignment) anything returned by `config.get(...)` mutates the shared config
  for the rest of the process, silently affecting every other call site that reads the same key
  afterward. Always `structuredClone()` (or equivalent) before mutating a `config.get()` result
  that needs to diverge from the live config for one specific use (see `server.ts`'s telemetry
  token, which needs no `expiresIn` while real user tokens still need one).

- **Generated projects need a `vitest.config.ts` with an SWC decorator-transform plugin —
  vitest's default esbuild transform cannot reliably handle the decorator-heavy code every
  model/route template produces.** `templates/server/vitest.config.ts` mirrors
  `service-core`/`react`'s own config: `unplugin-swc` with `legacyDecorator: true,
  decoratorMetadata: true`, plus the `@rapidrest/service-core/test` subpath alias (needed because
  the generated route test imports `{ request } from "@rapidrest/service-core/test"`) and
  `ssr.noExternal` for `@rapidrest/core`/`@rapidrest/service-core`. Don't remove this thinking it's
  redundant with `tsconfig.json`'s `emitDecoratorMetadata` — that setting alone doesn't help under
  vitest's default transform.

- **A template's own `template.config.json`/`patches/` must live at that template's root
  directory, not nested inside its own output structure.** `processTemplate()`
  (`src/lib/template.ts`) only ever looks for `join(templateDir, 'template.config.json')` — if it's
  nested (e.g. under `src/routes/` inside the `route` template instead of at `templates/route/`
  directly), `processTemplate` silently finds nothing: no patches ever apply, and the
  config/patch-fragment files themselves get copied into the generated project as stray output
  files instead of being consumed. This exact mistake existed in `templates/route/` until
  2026-08-23 and meant `generate route --protect`'s RBAC-enable patch never actually ran.

- **`@rapidrest/core`/`@rapidrest/service-core`'s compiled type declarations (`.d.ts`) reference
  `typeorm` and `redis` unconditionally**, regardless of whether a consumer's code path actually
  uses them — their "optional peer dependency" treatment doesn't extend to type-checking. A
  generated project missing either one fails `tsc` outright, even with zero SQL/redis features
  selected. `templates/server/package.json` handles this by always including both — as a real
  `dependencies` entry when the matching feature is selected (needed at runtime for the dynamic
  `import()`), otherwise as a `devDependencies` entry (needed only so `tsc` can resolve the types).
  If a third library gains the same pattern, apply the same always-present-somewhere fix rather
  than gating it purely on the feature flag.

- **`eslint-plugin-import` does not support `eslint@10` in any published version** (peer range caps
  at `^2 || ... || ^9`) — this blocks `npm install` outright (a hard `ERESOLVE` failure), though
  `yarn install` only warns. It was removed from the generated server template entirely rather than
  migrated to `eslint-plugin-import-x` (the actively-maintained fork this project's own
  `eslint-config-oclif@7` uses) since the template's `eslint.config.mjs` had zero active `import/*`
  rules — pure dead weight. If real `import/*` linting is wanted later, migrate to
  `eslint-plugin-import-x`, not the abandoned original.

- **Commit discipline.** Don't `git commit` unless explicitly asked, even after a full
  review-and-fix cycle with passing tests. Leave changes staged/unstaged and say so.

## Session Log

### 2026-08-21/23 — Dependency alignment, ACL/redis/TypeORM migration, auth removal, then a full
### correctness sweep verified by actually scaffolding projects

Multi-turn session, roughly in this order:

**Dependency upgrades.** Bumped the CLI's own `package.json` and every template's dependencies to
current versions, matching what `@rapidrest/core`/`service-core`/`react` themselves use (their
own `package.json`s are the source of truth, not npm's "latest" blindly). Held `typescript` at
`^6` rather than `^7` — TS7 (the native Go-rewrite) broke Yarn's built-in compat patch outright,
and none of the sibling repos have moved to it either. Kept `eslint-config-oclif` at `^6` in this
repo's own tooling (not the templates) since `^7` swaps `eslint-plugin-import` for
`eslint-plugin-import-x` and drops the standalone `@typescript-eslint/*` packages — a real config
migration, not a version bump.

**ACL migration.** `service-core`'s `ACLRecord` moved from boolean flags to `actions: ACLAction[]`
sometime before `rc.22` → `1.x` (undocumented in that library's own release notes — discovered by
diffing its test fixtures against the `v1.0.0-rc.22` tag). Migrated every `@Protect(...)` block in
the templates. Mapping used (confirmed against the library's own before/after fixtures):
`create/read/update/delete: true` → the matching `ACLAction.CREATE/READ/UPDATE/DELETE` entries;
`full: true` alone → `[ACLAction.FULL]`; `special` had no successor, just dropped.

**redis migration.** `@rapidrest/core`/`service-core` moved `RedisStore`/caching off `ioredis`
onto `redis` (node-redis v4+) at core `v4.0.0`. Replaced `ioredis`/`ioredis-mock` with `redis`
throughout the templates; the redis mock in generated tests is now a small inline fake
(`vi.mock("redis", () => ({ createClient: () => fakeClient }))`), not `ioredis-mock`.

**TypeORM 0.3 → 1.1.** `Connection` was removed from TypeORM's public API; replaced
`instanceof Connection` checks in generated tests with service-core's own duck-typed
`isSqlDataSource()` helper (exported from the package root), which needs no `typeorm` import at
all in the consuming code.

**Auth scaffolding removed.** Per explicit direction, deleted the generated server template's
`User` model, `UserRoute`, and `AuthRoute` (HTTP Basic login/logout) entirely rather than
reimplementing against `@rapidrest/auth` (the separate, still-prerelease package `BasicStrategy`
moved into) or vendoring the logic locally. `@Auth(["jwt"])` on other routes still works
out-of-the-box regardless — `AuthMiddleware.init()` auto-registers `JWTStrategy` by default; only
the login/token-issuing endpoint itself is gone.

**React multi-app static export.** `runStaticExport()`/`exportStaticSite()` (new in `react`
`v1.0.0`) support a single-app flat form and a multi-app `apps: [...]` form with different output
semantics (flat form always writes to `outDir` root; multi-app form prefixes output by each app's
`routePrefix`, so blindly always using the array form would change a single-app project's output
layout). Moved `src/export.ts`'s generation out of the Handlebars template and into `generate
react` itself, alongside `vite.config.ts`/`tsconfig.client.json` (same rationale: content depends
on every app in the project, which Handlebars can't see) — picks the flat form for exactly one
app, the array form otherwise.

**Full correctness sweep (2026-08-23), verified end-to-end.** User asked to review all templates
against current library versions and fix "similar gaps." Rather than only re-reading templates,
built a small scratch harness (`processTemplate()` called directly with hand-built contexts
matching what each `generate` command would produce, for `mongodb`/`postgresql`/`sqlite` ×
`npm`/`yarn`) and ran the *actual* `npm install`/`build`/`lint`/`test` cycle against the output.
This surfaced everything listed under Standing Decisions above, plus:
- The generated "create" test posted an object with no fields set, which failed the model's
  default non-nullable validation on its own identifier (`name` defaults to `""`) — masked
  previously because other tests use a `create{{model}}()` helper that calls `repo.save()`
  directly, bypassing HTTP-layer validation entirely.
- `repo.findOne({uid})`/`repo.count({uid})` in generated tests used MongoDB's bare-filter
  convention unconditionally; TypeORM's SQL repositories require `{ where: { uid } }` — a
  `no-unnecessary-type-assertion` lint error on the SQL branch (once fixed to not need `as any`)
  caught a leftover cast that should only apply to the Mongo branch.
- Generic per-key response-body comparisons in generated tests broke on `dateCreated`/
  `dateModified`/`version`/`_id` — all reassigned server/database-side on every write, so a
  client's pre-request copy is never expected to still match. Added a `SERVER_ASSIGNED_FIELDS`
  skip-set used consistently across every comparison loop in the test template.
- `templates/model/patches/*.json` (the `generate model`-time dependency patches — a separate code
  path from `generate server` that's easy to forget when updating "the" server template) were
  still on `typeorm@^0.3.20` with no `pg` and a misplaced/stale `better-sqlite3`.

Verified clean (build + lint + test, exit code 0) across mongodb/npm, postgresql/npm, sqlite/npm,
postgresql/yarn, and a bare no-model/no-route scaffold, before committing as `1dd6ba8`.

**Follow-up same day:** user separately reported `server.ts` deleting `expiresIn` directly off
`config.get("auth")` — see the `nconf` standing decision above. Confirmed the live-reference
behavior directly (`nconf.get()` then `delete` on the result, re-`get()` shows the key gone) before
fixing, rather than assuming the report was correct as stated.

### 2026-08-22 — `rapidrest doctor` (feature 1 of 5 planned this session)

User asked to brainstorm CLI feature ideas, then implement all of them one at a time, each as its
own commit. `doctor` was #1 (highest leverage): it automates the "actually scaffold a project and
check it" methodology from the correctness sweep above so it can be run against **any already-
generated project**, not just fresh scaffolds from a CLI dev session — catching drift against
whatever `@rapidrest/*` versions are currently installed.

Committed as `d2f8a06`: `src/lib/doctor.ts` (an extensible `Check`/`Finding` registry, one object
per bug pattern) + `src/commands/doctor.ts` (`--fix`/`--json` flags, non-zero exit on remaining
`error`-severity findings). Reused `extractDatastoreInfo` from `project.ts` where possible; added a
parallel `extractDatastoreBlocks` (full block text, not just name/type) rather than modifying the
existing tested function, since the sqlite-host check needs to inspect a whole datastore object.

Eight checks in v1: wrong SQL type literal, `better-sqlite3` missing `host`, missing
`vitest.config.ts`, `typeorm`/`redis` unresolvable, `eslint-plugin-import` + `eslint@10` conflict,
old boolean-flag ACL shape, `JWTUser` with an extra `name` field — the first three ship with a
`--fix`; the rest need a human (either the mapping is ambiguous, like ACL, or the call site should
be double-checked, like the `name` field).

**A test caught a real bug before it shipped.** The `sqlite-missing-host` fix inserted `host:
"localhost"` right after the `type: "better-sqlite3"` literal via regex, with `,?` in the *matched*
group to optionally consume an existing trailing comma. When `type` was the *last* property in the
block (no trailing comma in the source), the replacement produced `type: "better-sqlite3"\n  host:
"localhost",` — missing the comma between the two fields, i.e. invalid syntax. A unit test with a
single-property datastore block caught this. Fixed by moving the comma out of the optional group so
it's always emitted by the replacement itself, with the optional group only there to swallow (never
re-emit) a pre-existing comma. Lesson: when a fix touches object-literal source text, test the
"last property in the block" case explicitly — comma placement is exactly where regex-based source
patching breaks first.

Verified end-to-end per the plan: scaffolded a real project (`processTemplate()` called directly, a
postgresql+sqlite+redis context), hand-reintroduced the wrong SQL type literal, a sqlite datastore
missing `host`, and a deleted `vitest.config.ts`; `doctor` reported all three; `doctor --fix` fixed
all three cleanly (correct comma placement) and re-ran clean (`--json` → `"ok": true`).

Full suite stays green: 645 tests, 99.67%/99.15%/100%/99.67% stmt/branch/func/line coverage
(thresholds in `vitest.config.ts` are 0, not enforced — this is just the repo's existing bar).

### 2026-08-23 — `rapidrest upgrade` (feature 2 of 5)

Complement to `doctor`: re-syncs an already-generated project's generator-owned boilerplate files
and dependency version pins against whatever the currently installed CLI's `templates/` actually
contain, rather than checking for a fixed list of known-bad patterns. Committed alongside the
`d2f8a06` doctor work as its own commit per the user's "one feature at a time, own commit" rule.
Planned in plan mode first (`C:\Users\caska\.claude\plans\crispy-brewing-cook.md`), same as
`doctor`.

**Core safety rule, and why it's load-bearing:** only ever touch a file that already exists at that
exact path in the project; never create one. This single rule is what makes everything else safe
without needing accurate per-feature detection for *inclusion* — a project that never opted into
Docker/Helm/a given default-route simply doesn't have the file on disk, so it's a no-op
automatically, and conditional-file gates in a template's `template.config.json` can be forced
`true` at render time purely to avoid skipping a file that might exist, with zero risk of
fabricating something new.

**`src/config.ts`/`test/config.ts` are excluded outright — this was designed but initially NOT
implemented, and only caught by real end-to-end testing.** The plan explicitly called out that
config.ts is unsafe to sync (it's patch-mutated by `generate model`'s `ts-block-insert` — a custom
named datastore beyond the base scaffold's `acl`/`mongo`/`postgres`/`sqlite`/`cache`/`events`
blocks would silently vanish on a naive re-render from just `features.*` — and it's hand-edited
after generation). The exclusion never made it into the first cut of the code; a real scratch-
harness run against an actual scaffolded project didn't happen to surface it (that project only
used out-of-the-box feature blocks, no custom datastore, no hand-edits), so it looked clean. Caught
by deliberately hand-editing `src/config.ts` (a custom `cookie_secret` value) as part of the
"simulate drift" verification step and confirming it survived `--write` — this is exactly why the
plan's verification step insists on *real* end-to-end testing with deliberately reintroduced
drift, not just "does the happy path look right." Fixed with an `EXCLUDED_RELPATHS` set checked
before the existence/diff logic in `planFileChanges` (`src/lib/upgrade.ts`).

**Found and fixed a real, unrelated template bug via the same verification pass:**
`templates/server/README.md` used `{{project_description}}`, but `generate server`'s own context
object (`src/commands/generate/server.ts`) only ever sets `description` — `project_description` has
never been set by anything. Every project this CLI has ever scaffolded has shipped with a
permanently-empty description line in its README. Fixed the template to use `{{description}}`;
`upgrade`'s context builder now reads `description`/`repository` back from the project's own
`package.json` (both are literal strings there, written by the same template at generation time) so
already-scaffolded projects get backfilled correctly rather than just newly-generated ones.

**Architecture notes:**
- `src/lib/template.ts` gained one new export, `renderTemplateFiles(templateDir, context)` —
  same walk/exclude/Handlebars-render as `processTemplate`'s loop body (reusing its existing
  top-level private helpers: `walk`, `isExcluded`, `isHelmPath`, `processHelmSafe`), but returns
  `{relPath, content}[]` instead of writing to disk. `processTemplate` itself is untouched.
- Dependency-sync reuses `jsonMerge` from `patch.ts` completely as-is:
  `jsonMerge(projectPkg, { dependencies: canonical, devDependencies: canonical })` — patch values
  win on overlapping keys (version bump), patch-only keys get added, everything else in the
  project's `package.json` (including its own extra dependencies) passes through untouched. Never
  removes a dependency — that class of fix stays `doctor`'s job (e.g. its
  `eslint-plugin-import-conflict` check).
- `apiRoute`/`apiVersion` (needed to correctly re-render default-route files' `@Route`/`@ApiRoute`
  decorator line) have no dedicated record anywhere — recovered by regexing the one place they're
  already baked into generated content, `src/routes/HelloRoute.ts`'s own decorator.
- **Found `doctor.ts`'s `writePackageJson` reformats every project's `package.json` from tabs to
  2-space on any write**, since `templates/server/package.json` is tab-indented but
  `JSON.stringify(pkg, null, 2)` doesn't know that. Fixed once, shared: added
  `readProjectPackageJson`/`writeProjectPackageJson` to `project.ts` (indent auto-detected from the
  file's first indented line), refactored `doctor.ts` to delegate to them instead of its own
  private duplicate. `upgrade`'s own package.json writes use the same pair.

Verified end-to-end per the plan: scaffolded a real project, confirmed a clean scaffold reports
"Already up to date." (after the README fix backfilled the one legitimate pre-existing diff), then
simulated drift — hand-edited `eslint.config.mjs`, pinned `@rapidrest/core` to an old version, added
an unrelated `lodash` dependency, and hand-edited `src/config.ts`'s `cookie_secret`. `upgrade`
(dry-run) reported exactly the eslint file and the version pin, nothing else; `--write` applied
both, left `lodash` and the `config.ts` edit completely untouched, preserved tab indentation; a
second `--write` run reported no further changes.

Full suite: 704 tests, 99.57%/98.4%/99.44%/99.76% stmt/branch/func/line coverage.

### 2026-08-23 — `generate model` real property definitions (feature 3 of 5)

`generate model` used to scaffold exactly one field, the hardcoded `name: string` `@Identifier`
business key — no way to add real data properties without hand-editing afterward. Added a
repeatable `--property name:type` flag (`?` suffix on the type marks it optional, e.g.
`bio:string?`) plus, when no `--property` flags are given, an interactive loop (this codebase's
first "add another?"-style repeatable prompt — no prior precedent existed in `src/lib/prompts.ts`
or any command). `name` itself is untouched — it's load-bearing for `@Identifier`-based route
lookups, so new properties are added alongside it, never instead of it.

**Two real bugs found only by actually generating a model and reading/compiling the output** (the
same "reading templates isn't enough" lesson as the correctness-sweep and `doctor`/`upgrade`
entries above — this feature had unit tests passing throughout both bugs; only a real end-to-end
scratch-project `npm run build` caught them):
1. An **optional** property's default value was coming out as the type's normal zero value
   (`bio: string | undefined = ""`) instead of `undefined`. Wrong per `service-core`'s own
   convention (`User.ts`'s `uType: string | number | undefined = undefined` — a `@Nullable`
   property defaults to *absent*, not *present-but-empty*). Fixed via a small `resolveDefaultValue`
   helper in `model.ts`: `optional ? 'undefined' : formatDefaultPropertyValue(type)`.
2. A **non-optional custom type** (the property prompt's free-text "Other…" escape hatch, e.g.
   `--property sku:CustomSkuType`) defaulted to a bare `undefined` — a real `tsc` error, since
   `CustomSkuType` doesn't include `| undefined` in its type. `formatDefaultPropertyValue`'s
   fallback case now returns `'undefined as any'` instead, mirroring how
   `formatExamplePropertyValue`'s own fallback already handles unrecognized types (`'"updated" as
   any'`) — same problem, same established solution, just one file over.

Also fixed a real bug in the interactive `validate` callback's reserved-name check while writing
its unit test: `RESERVED_PROPERTY_NAMES` held `dateCreated`/`dateModified` in camelCase, but the
membership check lowercased the *candidate* name before checking — meaning those two entries could
never actually match (`'datecreated'` was never in the set). `uid`/`name`/`id`/`_id`/`version`
happened to already be all-lowercase so they worked; only the two camelCase entries were silently
broken. Fixed by lowercasing the set's own entries up front.

New shared helper `formatDefaultPropertyValue(type)` added to `project.ts` alongside its existing
sibling `formatExamplePropertyValue(type)` — same fixed type set the property-type `select` prompt
offers (`string`/`number`/`boolean`/`string[]`/`number[]`/`Date`), deliberately different literals
than its sibling since one needs a "changed" value for update tests and the other needs a
sensible "zero" value for initialization.

**Explicitly out of scope, not silently missed:** `generate route`'s example-property logic
(`extractFirstModelProperty`/`readModelProperty` in `project.ts`) still picks the model's *first*
`public` field for its generated update-test payload, which remains `name` even on a model with
real properties now — route.ts was intentionally not touched this feature, to keep the commit
scoped to `generate model` alone (same "each feature its own commit" discipline as 1 and 2).

Verified end-to-end: scaffolded a project, ran `generate model` non-interactively with
`--property quantity:number --property "bio:string?" --property tags:string[] --property
sku:CustomSkuType`, confirmed the rendered file's decorators/types/defaults/constructor were all
correct, then `npm install && npm run build && npm run lint` against the real scaffolded project —
compiled clean once `CustomSkuType` (a deliberately fictional type, there to prove the "Other…"
escape hatch doesn't crash the generator) was swapped for a real type, exactly the expected
behavior for a custom type the CLI can't know how to import on the user's behalf. Also confirmed
the zero-properties path (blank name at the first prompt) renders byte-for-byte the same model
output as before this feature, aside from one added blank line for readability.

Full suite: 732 tests, 99.58%/98.46%/99.47%/99.77% stmt/branch/func/line coverage.

### 2026-08-23 — non-interactive `generate server` (feature 4 of 5)

`generate server` had zero flag coverage beyond `force`/`author`/`output-dir` — every other
decision (description, package manager, DB features, "other" features [default routes + React +
Docker + K8s], API prefix, SCM) was prompt-only. User explicitly asked for **both** mechanisms
discussed in planning: full per-prompt flags (matching `model.ts`/`route.ts`/`default-route.ts`'s
existing convention) *and* an optional `--answers <file>` JSON profile, flags always winning over
the file, either winning over the prompt. All 40 pre-existing tests passed unmodified once the new
flags/answers layer was added — confirms the "flag/answer absent → prompt exactly as before" design
held for every field.

**The "additional features" checkbox had to be split into four flags (`--route`/`--react`/
`--docker`/`--k8s`) but treated as one group, not four independent fields** — unlike
`cache`/`protect`/etc., there's no clean way to "resume" part of a multi-select checkbox once one
piece has an answer. Rule: if *any* of the four (flag or `--answers` key) is present, skip the
whole checkbox and default the rest to what the checkbox itself defaults to today (`route`→none,
`react`→off, `docker`→**on**, `k8s`→off); if *none* is present, run the checkbox unchanged. Same
group-vs-field distinction doesn't apply to `--db` — it has no siblings, so it's a plain
`flag ?? answers ?? checkbox()`.

**A real, pre-existing, previously-undiscovered hang, found only by actually running the fully
flag-driven scaffold end-to-end (not by the unit tests, which mock `GenerateDefaultRoute`
entirely):** `generate server` invokes `generate default-route` internally for any selected default
routes, and passed it `--api <version>` only when the API prefix was accepted — when declined, it
just omitted `--api` rather than expressing "off". `default-route.ts`'s own resolution
(`if (!api && await confirm(...))`) can't tell "not specified, ask" apart from "specified as off",
so *any* non-interactive `generate server` run that both selects default routes and resolves
`apiRoute: false` (via `--no-api-route`, `--answers {"apiRoute": false}`, or even the top-level
interactive confirm declined) hits `default-route.ts`'s *own* "Is this an API route?" `confirm()` —
harmless-looking as a redundant question in interactive use (nobody seems to have noticed answering
it twice), a silent stdin-wait forever in a script/CI. The README already documented `--api ''`
(empty value) as meaning "on, no version" — also broken, since `''` is falsy and `!api` treated it
identically to "not passed" too. Root cause in both cases: overloading one string flag to carry
three states (on+version / on+no-version / off) when `!flags.api` can only ever distinguish two.
Fixed by giving `default-route.ts` a proper `--api-route`/`--no-api-route` boolean (mirrors the
tri-state design already used for `generate server`'s own new flag of the same name) — `--api
<value>` alone still implies `--api-route` for backward compatibility, so no existing usage breaks.
`generate server` now always passes one or the other explicitly, never omits both. `route.ts` has
the identical `!api` pattern but is never invoked by `generate server`, so it's not load-bearing for
this feature and was deliberately left alone — noted here as a known, still-open, lower-priority
instance of the same bug class for whenever it becomes relevant.

Verified end-to-end per the plan: scaffolded a project three ways — flags alone (`--db`, `--route`,
`--pkg-manager`, `--api-route --api-version`, `--scm`, etc., zero prompts, zero stdin), `--answers
<file>` alone (this run is what surfaced the hang above, before the default-route.ts fix), and a
mixed run overriding two fields (`--pkg-manager`, `--api-version`) on top of an answers file
(confirmed the overridden fields came from the flags, everything else still came from the file).
`npm install && npm run build && npm run lint` clean on all three (no test files exist without a
`generate model`+`generate route` also being run — same expected/pre-existing situation as feature
3's verification, not a regression).

Full suite: 766 tests, 99.6%/98.5%/99.49%/99.78% stmt/branch/func/line coverage.

### 2026-08-23 — `generate auth` (feature 5 of 5 — roadmap complete)

Re-introduces auth scaffolding as an **opt-in** command, backed by `@rapidrest/auth`, now
genuinely `1.0.0` (confirmed `d:\github\rapidrest\auth\package.json` — real, published, resolves
from the npm registry, not just a version-string claim). Original built-in scaffolding was removed
this session (commit `c52f22f`) when `BasicStrategy` moved out of `service-core` into
`@rapidrest/auth` while it was still prerelease.

**The library is much bigger than the old hand-rolled templates (MFA/OIDC/FIDO2/Passkey/TOTP/
elevation/refresh/discovery/profile management) — scoping this down was the actual work.** Read
the library's own source *and*, critically, its own test fixture consuming projects
(`auth/test/server-sql/`, `auth/test/server-mongo/` — real example route files showing the intended
integration shape) rather than guessing from the public API alone. That surfaced two things no
amount of reading the barrel exports would have:
- **`User`/`Alias`/`Secret`/`Profile` are not meant to be hand-written or subclassed** — the
  package ships ready-made `UserSQL`/`AliasSQL`/... (from `@rapidrest/auth/sql`) and Mongo
  equivalents; a consuming project just re-exports the specific named classes from one file
  (`export { UserSQL, AliasSQL, SecretSQL, ProfileSQL } from "@rapidrest/auth/sql";` — named, not
  `export *`, since the combined `/sql` barrel also bundles route and job base classes that
  shouldn't be blanket re-exported through a "models" file) so `service-core`'s ClassLoader
  discovers their `@DataStore`/`@Entity` metadata. Routes are equally thin: `class AuthBasicRoute
  extends BaseAuthBasicRouteSQL {}` plus one `@Route(...)` decorator — the fixture's own route
  files are 4-11 lines each.
- **A real, unresearchable-from-outside constraint: `UserSQL`/`UserMongo` carry a hardcoded
  `@DataStore("sql")`/`@DataStore("mongo")` in the library's own source** (not the test fixture —
  confirmed by reading `auth/src/models/{sql/UserSQL,mongo/UserMongo}.ts` directly). Unlike
  `generate model`, where a datastore can be named anything, a project using this library's shipped
  `User` class **must** have a datastore literally named `sql` or `mongo`. `generate auth` handles
  this by checking for an existing datastore with that exact name first (reusing
  `readProjectDatastores`), and only prompts for a SQL sub-type (postgres/sqlite) when creating a
  new one from scratch — reusing `generate model`'s own `ts-block-insert`-into-`datastores` patch
  idiom (own copy under `templates/auth/patches/`, since patch template files resolve relative to
  their own template root, no cross-directory sharing).

Scope for v1, chosen to be a genuinely complete "sign up → log in → access protected data → log
out" flow rather than a token gesture at the whole library: `RegistrationRoute` (self-service
sign-up — creates User+Alias+Secret atomically, the library's own consolidated onboarding
endpoint, chosen over exposing raw Alias/Secret CRUD directly), `AuthBasicRoute` (login),
`AuthLogoutRoute` (logout, datastore-agnostic — imported from the package root, not `/sql`/
`/mongo`), `UserRoute` (admin CRUD, RBAC-gated by the library's own deny-by-default `@Protect` on
`User`). `--default-accounts` is opt-in (off by default) since it writes a generated password to
disk/log on first boot — a deliberate operator choice, not a default.

Small refactor while wiring `apiRoute`/`apiVersion` detection: moved `detectApiRoute` out of
`upgrade.ts` (where it was private/module-local) into the shared `project.ts`, since it's generic
project-introspection, not upgrade-specific logic, and `generate auth` needed the exact same
"recover the API prefix convention from HelloRoute.ts" behavior. `upgrade.ts` now imports it from
there too; `upgrade.test.ts` needed no changes (only ever exercised it indirectly via `planUpgrade`).

One cosmetic, deliberately-not-fixed finding: `tsBlockInsert` (`src/lib/patch.ts`) splices the
patch snippet as literal text immediately before the target block's closing `}` character, with no
re-indentation — so a patch fragment's own leading whitespace on its first/last lines interacts
with whatever whitespace already precedes that `}` in the target file, producing a datastore entry
that's indented slightly differently from its hand-written siblings. Verified this is genuinely
cosmetic (doesn't affect `tsc`/`eslint`, `generate model`'s already-shipped, already-verified patch
has the exact same characteristic) rather than chasing pixel-perfect alignment in a mechanically
spliced insert — `templates/auth/patches/config-datastore.ts.hbs` intentionally matches
`templates/model/patches/config-datastore.ts.hbs`'s existing indentation convention rather than
"fixing" it in only one of the two places.

Verified end-to-end against the **real, published** `@rapidrest/auth@1.0.0` (not just reading its
source): scaffolded a project, ran `generate auth --datastore-type sql --sql-type better-sqlite3`
creating a new `sql` datastore, then `npm install && npm run build && npm run lint` — clean,
confirming `@Model(UserSQL)`'s binding, the `/sql` subpath import, and `argon2`'s dynamic-import
path all resolve correctly against the real package (not just plausible from reading the source).
Re-ran with `--default-accounts --force` against the same project to confirm the datastore patch
is idempotent (no duplicate block) and the job file compiles. Repeated the whole cycle for
`--datastore-type mongo` on a fresh scaffold — also clean.

Full suite: 794 tests, 99.61%/98.54%/99.5%/99.78% stmt/branch/func/line coverage.

**Roadmap complete** — all 5 features from the original brainstorm are implemented, verified
end-to-end against real scaffolded projects, and committed as their own commits: `doctor`
(`d2f8a06`), `upgrade` (`30debb2`), `generate model` properties (`91a8087`), non-interactive
`generate server` (`3e16fda`), `generate auth` (this entry, commit pending as of this note).
