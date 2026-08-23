///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BaseAuthMFARoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Logs a user in with a password plus a second factor (FIDO2, OTP, a recovery code, or TOTP) and
 * issues an access token.
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/mfa"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class AuthMFARoute extends BaseAuthMFARoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
