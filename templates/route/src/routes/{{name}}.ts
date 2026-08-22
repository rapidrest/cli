///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { JWTUser, ObjectDecorators } from "@rapidrest/core";
import {
    {{#if protect}}
    ACLAction,
    {{/if}}
    DocDecorators,
    RouteDecorators,
    {{#if model}}
    CRUDRoute,
    {{/if}}
} from "@rapidrest/service-core";
{{#if model}}
import {{model}} from "../models/{{model}}.js";
{{/if}}

const { Init } = ObjectDecorators;
const {
    Summary,
    Description,
    Returns,
    {{#if model}}
    TypeInfo,
    {{/if}}
} = DocDecorators;
const {
    {{#if model}}
    Auth,
    Delete,
    {{/if}}
    Get,
    {{#if model}}
    Head,
    Model,
    Param,
    Post,
    Put,
    Query,
    Request,
    Response,
    {{/if}}
    {{#if protect}}
    Protect,
    {{/if}}
    {{#if apiRoute}}Api{{/if}}Route,
    User,
    {{#if model}}
    Validate
    {{/if}}
} = RouteDecorators;

/**
 * {{description}}
 * 
 * @author {{author}}
 */
@Description("{{description}}")
{{#if model}}
@Model({{model}})
{{/if}}
@{{#if apiRoute}}Api{{/if}}Route("{{path}}"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
{{#if protect}}
@Protect(
    {
        uid: "{{name}}",
        records: [
            {
                userOrRoleId: "anonymous",
                actions: [ACLAction.READ, ACLAction.LIST, ACLAction.COUNT, ACLAction.EXISTS],
            },
            {
                userOrRoleId: ".*",
                actions: [ACLAction.READ, ACLAction.LIST, ACLAction.COUNT, ACLAction.EXISTS],
            }
        ]
    },
    true
)
{{/if}}
export default class {{name}}{{#if model}} extends CRUDRoute<{{model}}>{{/if}} {
    /**
     * Called on server startup to initialize the route with any defaults.
     */
    @Init
    private async initialize() {
        // TODO
    }
{{#unless model}}

    /**
     * Sends a friendly greeting to the user.
     */
    @Summary("hello")
    @Description("Sends a friendly greeting to the user.")
    @Returns([string])
    @Get()
    private async hello(@User user?: JWTUser): Promise<string> {
        return `Hello ${user ? user.name : 'World'}!`;
    }
{{/unless}}
}