///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BaseACLRoute, RouteDecorators } from "@rapidrest/service-core";
const { Model, Route } = RouteDecorators;

{{#if features.mongodb}}
@Model(AccessControlListMongo)
{{else}}
@Model(AccessControlListSQL)
{{/if}}
@Route("/acls")
export class ACLRoute extends BaseACLRoute<{{#if features.mongodb}}AccessControlListMongo{{else}}AccessControlListSQL{{/if}}> {}