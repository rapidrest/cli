///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
// Re-exported so the server's ClassLoader discovers and runs this job on startup — it
// auto-provisions a default admin account the first time the server boots against an empty user
// table. Configure it via the `default_accounts` key in `src/config.ts`, e.g.:
//   default_accounts: [{ name: "admin", roles: ["admin"] }]
// The generated password is logged (or written to a file — see @rapidrest/auth's own
// documentation for `auth:password_file`) on first run; change it immediately in production.
export { DefaultAccounts{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
