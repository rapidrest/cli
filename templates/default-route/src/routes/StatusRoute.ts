///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BaseStatusRoute, RouteDecorators } from "@rapidrest/service-core";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

@{{#if apiRoute}}Api{{/if}}Route("/status"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class StatusRoute extends BaseStatusRoute {}