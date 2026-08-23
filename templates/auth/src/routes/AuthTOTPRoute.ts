///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BaseAuthTOTPRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Logs a user in with a Time-based One-Time Password (RFC 6238, e.g. Google Authenticator) and
 * issues an access token. Enroll a TOTP secret via `POST /secrets` with `type: "totp"`.
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/totp"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class AuthTOTPRoute extends BaseAuthTOTPRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
