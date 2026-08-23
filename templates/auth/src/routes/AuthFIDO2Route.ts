///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { BaseAuthFIDO2Route{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * Logs a user in with a FIDO2 hardware security key (e.g. a YubiKey) and issues an access token.
 * Register a key via `GET /secrets/fido2/register` followed by `POST /secrets` with `type: "fido2"`.
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/fido2"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class AuthFIDO2Route extends BaseAuthFIDO2Route{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
