///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { JWTUser, ObjectDecorators } from "@rapidrest/core";
import { HttpRequest, HttpResponse, RouteDecorators } from "@rapidrest/service-core";
import { AuthResult, OIDCProvider } from "@rapidrest/auth";
import { BaseAuthOIDCRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} } from "@rapidrest/auth/{{#if isSql}}sql{{else}}mongo{{/if}}";
const { Config } = ObjectDecorators;
const { {{#if apiRoute}}Api{{/if}}Route, Auth, Get, Post, Request, Response, User } = RouteDecorators;

/**
 * Logs a user in via {{label}} OAuth 2.0 / OpenID Connect and issues an access token.
 *
 * `strategyName`/`login()` are overridden (rather than left at `BaseAuthOIDCRoute`'s "oauth"
 * default) so this provider registers under its own name and doesn't collide with any other OIDC
 * provider route generated alongside it — see `BaseAuthOIDCRoute`'s own doc comments.
 *
 * `providerConfig` is read from the `auth.{{name}}` block in src/config.ts (including the client
 * ID/secret entered when this file was generated) rather than inlined here — override any of it
 * in a real deployment via the environment, same as every other secret-shaped config value.
 *
 * @author {{author}}
 */
@{{#if apiRoute}}Api{{/if}}Route("/auth/oidc/{{providerKey}}"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class Auth{{providerClassName}}Route extends BaseAuthOIDCRoute{{#if isSql}}SQL{{else}}Mongo{{/if}} {
    protected strategyName = "{{name}}";

    @Config("auth:{{name}}")
    protected providerConfig: OIDCProvider = {
        name: "{{name}}",
        authorizationURL: "",
        clientID: "",
        clientSecret: "",
        protocol: "{{protocol}}",
        redirectURI: "",
        tokenURL: "",
    };

    @Auth(["{{name}}"])
    @Get()
    @Post()
    public override async login(
        @User user: JWTUser,
        @Request req: HttpRequest,
        @Response res: HttpResponse,
    ): Promise<AuthResult | undefined> {
        return super.login(user, req, res);
    }
}
