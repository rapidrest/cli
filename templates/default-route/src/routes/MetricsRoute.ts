///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BaseMetricsRoute, RouteDecorators } from "@rapidrest/service-core";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

@{{#if apiRoute}}Api{{/if}}Route("/metrics"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class MetricsRoute extends BaseMetricsRoute {}