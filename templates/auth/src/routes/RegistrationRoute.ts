///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BaseRegistrationRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Self-service account registration — creates a new user, their login alias, and password
 * secret in one call, then issues them an access token.
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/register"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class RegistrationRoute extends BaseRegistrationRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
