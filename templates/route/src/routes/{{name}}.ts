///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { JWTUser, ObjectDecorators } from "@rapidrest/core";
import {
    RouteDecorators,
    DocDecorators,
    {{#if model}}
    HttpRequest,
    HttpResponse,
    ModelRoute,
    RepoUtils,
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
    Route,
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
@Route("{{path}}")
{{#if protect}}
@Protect(
    {
        uid: "{{name}}",
        records: [
            {
                userOrRoleId: "anonymous",
                create: false,
                read: true,
                update: false,
                delete: false,
                special: false,
                full: false,
            },
            {
                userOrRoleId: ".*",
                create: false,
                read: true,
                update: false,
                delete: false,
                special: false,
                full: false,
            }
        ]
    },
    true
)
{{/if}}
export default class {{name}}{{#if model}} extends ModelRoute<{{model}}>{{/if}} {
    {{#if model}}
    protected repoUtilsClass: any = RepoUtils;

    {{/if}}
    /**
     * Called on server startup to initialize the route with any defaults.
     */
    @Init
    private async initialize() {
        // TODO
    }
{{#if model}}

    @Summary("Count {{model}}s")
    @Description("Returns the total count of {{model}}s in the datastore based on the given criteria "
        + "in the header as `Content-Length`.")
    @Returns([Object])
    @Head()
    private async count(
        @Param() params: any,
        @Query() query: any,
        @Response res: HttpResponse,
        @User user: JWTUser
    ): Promise<any> {
        return super.doCount({ params, query, res, user });
    }

    public validateCreate(obj: Partial<{{model}}> | Partial<{{model}}>[], @User user: JWTUser) {
        return super.doValidate(obj, { user });
    }

    /**
     * Create a new {{model}}.
     */
    @Summary("Create {{model}}(s)")
    @Description("Create a new {{model}}.")
    @Returns([{{model}}])
    @Auth(["jwt"])
    @Post()
    @Validate("validateCreate")
    private create(obj: {{model}} | {{model}}[], @Request req: HttpRequest, @User user: JWTUser): Promise<{{model}} | Array<{{model}}>> {
        return super.doCreate(obj, { req, user });
    }

    /**
     * Deletes the {{model}}
     */
    @Summary("Delete {{model}} by ID")
    @Description("Deletes the {{model}} from the service.")
    @Returns([null])
    @Auth(["jwt"])
    @Delete("/:id")
    private async delete(@Param("id") id: string, @Request req: HttpRequest, @User user: JWTUser): Promise<void> {
        return super.doDelete(id, { user, req });
    }

    /**
     * Returns all {{model}}s from the system that the user has access to
     */
    @Summary("Find All {{model}}s")
    @Description("Returns all {{model}}s from the system that the user has access to.")
    @Returns([[Array, {{model}}]])
    @Get()
    private async findAll(@Param() params: any, @Query() query: any, @User user: JWTUser): Promise<Array<{{model}}>> {
        return super.doFindAll({ params, query, user });
    }

    /**
     * Returns a single {{model}} from the system that the user has access to
     */
    @Summary("Find {{model}} by ID")
    @Description("Returns a single {{model}} from the system that the user has access to.")
    @Returns([{{model}}])
    @Get("/:id")
    private async findById(@Param("id") id: string, @Query() query: any, @User user: JWTUser): Promise<{{model}} | null> {
        return super.doFindById(id, { query, user });
    }

    @Summary("Truncate {{model}}s")
    @Description("Deletes all {{model}}s from the datastore that the user has access to.")
    @Returns([null])
    @Auth(["jwt"])
    @Delete()
    public async truncate(
        @Param() params: any,
        @Query() query: any,
        @User user: JWTUser
    ): Promise<void> {
        return super.doTruncate({ params, query, user });
    }

    public async validateUpdate(@Param("id") id: string, obj: UpdateObject<{{model}}>, @User user: JWTUser) {
        return super.doValidate(obj, { user });
    }

    /**
     * Updates a single {{model}}
     */
    @Summary("Update {{model}} by ID")
    @Description("Updates a single {{model}}.")
    @Returns([{{model}}])
    @Auth(["jwt"])
    @Put("/:id")
    @Validate("validateUpdate")
    private async update(@Param("id") id: string, obj: UpdateObject<{{model}}>, @Request req: HttpRequest, @User user: JWTUser): Promise<{{model}}> {
        return super.doUpdate(id, obj, { user });
    }

    @Summary("Update {{model}} by ID and property")
    @Put(":id/:property")
    @Description("Updates a single property of an existing {{model}}.")
    @TypeInfo([Object])
    @Returns([{{model}}])
    protected updateProperty(
        @Param("id") id: string,
        @Param("property") propertyName: string,
        obj: any,
        @User user: JWTUser
    ): Promise<{{model}}> {
        return super.doUpdateProperty(id, propertyName, obj, { user });
    }
{{else}}

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
{{/if}}
}