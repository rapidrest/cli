///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BaseAuthBasicRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Logs a user in with a username/password (HTTP Basic) credential and issues an access token.
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/basic"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class AuthBasicRoute extends BaseAuthBasicRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
