///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BaseAuthPasskeyRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Logs a user in with a WebAuthn passkey (synced credential) and issues an access token. Register
 * a passkey via `GET /secrets/passkey/register` followed by `POST /secrets` with `type: "passkey"`.
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/passkey"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class AuthPasskeyRoute extends BaseAuthPasskeyRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
