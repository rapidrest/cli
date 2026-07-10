///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BasePushRoute, RouteDecorators } from "@rapidrest/service-core";
const { {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

@{{#if apiRoute}}Api{{/if}}Route("/push"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class PushRoute extends BasePushRoute {}