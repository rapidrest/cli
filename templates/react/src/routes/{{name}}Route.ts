///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ReactRoute } from "@rapidrest/react";
import { RouteDecorators } from "@rapidrest/service-core";

const { Route } = RouteDecorators;

@Route("{{path}}/*")
export class AppRoute extends ReactRoute {
    protected readonly appDir: number = "apps/{{name}}";
    {{#if cache}}
    protected readonly cacheTTL: number = {{cache}};
    {{/if}}
    {{#if hydrate}}
    protected readonly hydrate: boolean = {{hydrate}};
    {{/if}}
}
