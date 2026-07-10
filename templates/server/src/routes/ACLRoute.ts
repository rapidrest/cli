///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BaseACLRoute, RouteDecorators } from "@rapidrest/service-core";
const { Route } = RouteDecorators;

{{#if features.mongodb}}
@Route(AccessControlListMongo)
{{else}}
@Route(AccessControlListSQL)
{{/if}}
@Route("/acls")
export class ACLRoute extends BaseACLRoute<{{#if features.mongodb}}AccessControlListMongo{{else}}AccessControlListSQL{{/if}}> {}