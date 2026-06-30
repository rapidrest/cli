///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import {
    RouteDecorators,
    DocDecorators,
    ModelRoute,
    RepoUtils,
    UpdateObject,
    ApiErrorMessages,
    HttpResponse,
    HttpRequest
} from "@rapidrest/service-core";
import User from "../models/User.js";
import { ApiError, JWTUser, ObjectDecorators, UserUtils} from "@rapidrest/core";

const { Description, Returns, Summary, TypeInfo } = DocDecorators;
const { Config } = ObjectDecorators;
const {
    Auth,
    Delete,
    Get,
    Head,
    Model,
    Query,
    Param,
    Post,
    Put,
    Request,
    Response,
    Route,
    Validate
} = RouteDecorators;
const AuthUser = RouteDecorators.User;

/**
 * Handles all REST API requests for the endpoint `/user`.
 * 
 * @author {{author}}
 */
@Model(User)
@Route("/user")
class UserRoute extends ModelRoute<User> {
    protected repoUtilsClass: any = RepoUtils;

    @Config("trusted_roles", ["admin"])
    protected trustedRoles: string[] = [];

    @Summary("Count Users")
    @Description("Returns the total count of Users in the datastore based on the given criteria "
        + "in the header as `Content-Length`.")
    @Returns([Object])
    @Auth(["jwt"])
    @Head()
    private async count(
        @Param() params: any,
        @Query() query: any,
        @Response res: HttpResponse,
        @AuthUser user: JWTUser
    ): Promise<any> {
        return super.doCount({ params, query, res, user });
    }

    public async validateCreate(obj: Partial<User> | Partial<User>[], @AuthUser user: JWTUser) {
        await super.doValidate(obj, { user });
    }

    /**
     * Create a new User.
     */
    @Summary("Create User")
    @Description("Create a new User.")
    @Returns([User])
    @Post()
    @Validate("validateCreate")
    private async create(obj: User | User[], @Request req: HttpRequest, @AuthUser user: JWTUser): Promise<User | Array<User>> {
        return super.doCreate(obj, { user, req });
    }

    /**
     * Deletes the User
     */
    @Summary("Delete user by ID")
    @Description("Deletes the user from the service.")
    @Returns([null])
    @Auth(["jwt"])
    @Delete("/:id")
    private async delete(@Param("id") id: string, @Request req: HttpRequest, @AuthUser user: JWTUser): Promise<void> {
        return super.doDelete(id, { user, req });
    }

    /**
     * Returns all Users from the system that the user has access to
     */
    @Summary("Find All Users")
    @Description("Returns all Users from the system that the user has access to.")
    @Returns([[Array, User]])
    @Auth(["jwt"])
    @Get()
    private async findAll(@Param() params: any, @Query() query: any, @AuthUser user: JWTUser): Promise<Array<User>> {
        return super.doFindAll({ params, query, user });
    }

    /**
     * Returns a single User from the system that the user has access to
     */
    @Summary("Find user by ID")
    @Description("Returns a single User from the system that the user has access to.")
    @Returns([User])
    @Auth(["jwt"])
    @Get("/:id")
    private async findById(@Param("id") id: string, @Query() query: any, @AuthUser user: JWTUser): Promise<User | null> {
        return super.doFindById(id, { query, user });
    }

    @Summary("Truncate Users")
    @Description("Deletes all Users from the datastore that the user has access to.")
    @Returns([null])
    @Auth(["jwt"])
    @Delete()
    public async truncate(
        @Param() params: any,
        @Query() query: any,
        @AuthUser user: JWTUser
    ): Promise<void> {
        return super.doTruncate({ params, query, user });
    }

    public async validateUpdate(@Param("id") id: string, obj: UpdateObject<User>, @AuthUser user: JWTUser) {
        await super.doValidate(obj, { user });

        // Only admins and the user itself can make changes
        if (!UserUtils.hasRoles(user, this.trustedRoles) && (id !== user.uid || obj.uid !== user.uid)) {
            throw new ApiError(ApiErrorMessages.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
    }

    /**
     * Updates a single User
     */
    @Summary("Update user by ID")
    @Description("Updates a single User.")
    @Returns([User])
    @Auth(["jwt"])
    @Put("/:id")
    @Validate("validateUpdate")
    private async update(@Param("id") id: string, obj: UpdateObject<User>, @Request req: HttpRequest, @AuthUser user: JWTUser): Promise<User> {
        return super.doUpdate(id, obj, { user });
    }

    @Summary("Update user by ID and property")
    @Put(":id/:property")
    @Description("Updates a single property of an existing user.")
    @TypeInfo([Object])
    @Returns([User])
    protected updateProperty(
        @Param("id") id: string,
        @Param("property") propertyName: string,
        obj: any,
        @AuthUser user: JWTUser
    ): Promise<User> {
        // Only admins and the user itself can make changes
        if (!UserUtils.hasRoles(user, this.trustedRoles) && (id !== user.uid || obj.uid !== user.uid)) {
            throw new ApiError(ApiErrorMessages.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        return super.doUpdateProperty(id, propertyName, obj, { user });
    }
}

export default UserRoute;
