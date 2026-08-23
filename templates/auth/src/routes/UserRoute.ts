///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { User{{#if isSql}}SQL{{else}}Mongo{{/if}}, BaseUserRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { Model, {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Administrative CRUD over user accounts. Access is governed by
 * `User{{#if isSql}}SQL{{else}}Mongo{{/if}}`'s own `@Protect(...)` ACL (deny-by-default for
 * everyone but the record's own owner) — grant broader access via `trusted_roles` in
 * `src/config.ts` or a project-specific ACL patch.
 *
 * @author {{author}}
 */
@Model(User{{#if isSql}}SQL{{else}}Mongo{{/if}})
@{{#if apiRoute}}Api{{/if}}Route("/users"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class UserRoute extends BaseUserRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
