///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { ReactRoute } from "@rapidrest/react";
import { RouteDecorators } from "@rapidrest/service-core";
const { Route } = RouteDecorators;

@Route("{{path}}/*")
export class {{className}}Route extends ReactRoute {
    protected readonly appDir: number = "apps/{{name}}";
    {{#if cache}}
    protected readonly cacheTTL: number = {{cache}};
    {{/if}}
    {{#if hydrate}}
    protected readonly hydrate: boolean = {{hydrate}};
    {{/if}}
}
