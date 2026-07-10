///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { {{#if features.mongodb}}AccessControlListMongo, {{else}}AccessControlListSQL, {{/if}}BaseACLRoute, RouteDecorators } from "@rapidrest/service-core";
const { Model, {{#if apiRoute}}Api{{/if}}Route } = RouteDecorators;

{{#if features.mongodb}}
@Model(AccessControlListMongo)
{{else}}
@Model(AccessControlListSQL)
{{/if}}
@{{#if apiRoute}}Api{{/if}}Route("/acls"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
export class ACLRoute extends BaseACLRoute<{{#if features.mongodb}}AccessControlListMongo{{else}}AccessControlListSQL{{/if}}> {}