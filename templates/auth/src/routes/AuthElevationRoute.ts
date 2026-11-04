///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BaseAuthElevationRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Elevates the current session after the user re-verifies their identity (a second factor, or their
 * password when they have none enrolled). Required by every `@RequiresElevation`-gated action, such as
 * changing secrets, managing users and the admin restart/clear-cache endpoints.
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/elevation"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class AuthElevationRoute extends BaseAuthElevationRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
