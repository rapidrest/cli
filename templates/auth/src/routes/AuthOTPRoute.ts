///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BaseAuthOTPRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Logs a user in with a one-time password (OTP) sent via email or SMS and issues an access token.
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/otp"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class AuthOTPRoute extends BaseAuthOTPRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
