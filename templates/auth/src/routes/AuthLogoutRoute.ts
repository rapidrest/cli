///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BaseAuthLogoutRoute } from "@rapidrest/auth";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Logs the current user out, clearing their session cookie (if any).
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/logout"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class AuthLogoutRoute extends BaseAuthLogoutRoute {}
