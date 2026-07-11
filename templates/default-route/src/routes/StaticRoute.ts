///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BaseStaticRoute, RouteDecorators } from "@rapidrest/service-core";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

@{{#if apiRoute}}Api{{/if}}Route("/"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class StaticRoute extends BaseStaticRoute {}