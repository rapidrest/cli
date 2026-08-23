///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
// Re-exports @rapidrest/auth's ready-made {{#if isSql}}SQL{{else}}MongoDB{{/if}} model classes so
// the server's ClassLoader discovers their @DataStore/@Entity metadata. These are not meant to be
// subclassed or edited — customize behavior via the routes in src/routes/ instead.
export { User{{#if isSql}}SQL{{else}}Mongo{{/if}}, Alias{{#if isSql}}SQL{{else}}Mongo{{/if}}, Secret{{#if isSql}}SQL{{else}}Mongo{{/if}}, Profile{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
