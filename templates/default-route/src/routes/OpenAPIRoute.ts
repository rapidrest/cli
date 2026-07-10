///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BaseOpenAPIRoute, RouteDecorators } from "@rapidrest/service-core";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

@{{#if apiRoute}}Api{{/if}}Route("/openapi"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class OpenAPIRoute extends BaseOpenAPIRoute {}