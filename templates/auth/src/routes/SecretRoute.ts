///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { RouteDecorators } from "@rapidrest/service-core";
import { Secret{{#if isSql}}SQL{{else}}Mongo{{/if}}, BaseSecretRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { Model, {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

/**
 * CRUD over authentication secrets (password, TOTP, passkey, FIDO2, recovery codes). Also exposes
 * the passkey/FIDO2 registration-options endpoints and is how a password gets changed after
 * `RegistrationRoute` creates the initial one.
 *
 * @author {{author}}
 */
@Model(Secret{{#if isSql}}SQL{{else}}Mongo{{/if}})
@{{#if apiRoute}}Api{{/if}}Route("/secrets"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class SecretRoute extends BaseSecretRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {}
