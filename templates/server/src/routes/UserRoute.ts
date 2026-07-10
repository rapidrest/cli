///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import {
    ApiErrorMessages,
    CRUDRoute,
    HttpResponse,
    HttpRequest,
    RepoUtils,
    RouteDecorators,
    UpdateObject,
} from "@rapidrest/service-core";
import User from "../models/User.js";
import { ApiError, JWTUser, ObjectDecorators, UserUtils} from "@rapidrest/core";

const { Config } = ObjectDecorators;
const {
    Auth,
    Model,
    Query,
    Param,
    Request,
    Response,
    {{#if apiRoute}}Api{{/if}}Route,
} = RouteDecorators;
const AuthUser = RouteDecorators.User;

/**
 * Handles all REST API requests for the endpoint `/user`.
 * 
 * @author {{author}}
 */
@Model(User)
@{{#if apiRoute}}Api{{/if}}Route("/user"{{#if apiVersion}}, "{{apiVersion}}"{{/if}})
class UserRoute extends CRUDRoute<User> {
    protected repoUtilsClass: any = RepoUtils;

    @Config("trusted_roles", ["admin"])
    protected trustedRoles: string[] = [];

    @Auth(["jwt"])
    public async count(
        @Param() params: any,
        @Query() query: any,
        @Response res: HttpResponse,
        @User user?: JWTUser,
    ): Promise<any> {
        return super.doCount({ params, query, res, user });
    }

    protected async validateCreate(obj: Partial<User> | Partial<User>[], @AuthUser user: JWTUser) {
        await super.doValidate(obj, { user });
    }

    @Auth(["jwt"])
    public async delete(
        @Param("id") id: string,
        @Query("version") version: string | undefined,
        @Query("purge") purge: string | undefined,
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<void> {
        return super.doDelete(id, { user, req, version, purge: purge === "true" });
    }

    @Auth(["jwt"])
    public async exists(
        @Param("id") id: string,
        @Query() query: any,
        @Response res: HttpResponse,
        @User user?: JWTUser,
    ): Promise<any> {
        return super.doExists(id, { query, res, user });
    }

    @Auth(["jwt"])
    public async find(@Param() params: any, @Query() query: any, @User user?: JWTUser): Promise<Array<T>> {
        return super.doFind({ params, query, user });
    }

    @Auth(["jwt"])
    public async findById(@Param("id") id: string, @Query() query: any, @User user?: JWTUser): Promise<T | null> {
        return super.doFindById(id, { query, user });
    }

    @Auth(["jwt"])
    public async truncate(@Param() params: any, @Query() query: any, @User user?: JWTUser): Promise<void> {
        return super.doTruncate({ params, query, user });
    }

    protected async validateUpdate(@Param("id") id: string, obj: UpdateObject<User>, @AuthUser user: JWTUser) {
        await super.doValidate(obj, { user });

        // Only admins and the user itself can make changes
        if (!UserUtils.hasRoles(user, this.trustedRoles) && (id !== user.uid || obj.uid !== user.uid)) {
            throw new ApiError(ApiErrorMessages.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
    }

    @Auth(["jwt"])
    public async update(
        @Param("id") id: string,
        obj: UpdateObject<T>,
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<T> {
        return super.doUpdate(id, obj, { user });
    }

    @Auth(["jwt"])
    public async updateBulk(obj: UpdateObject<T>[], @Request req: HttpRequest, @User user?: JWTUser): Promise<T[]> {
        return super.doBulkUpdate(obj, { user, req });
    }

    @Auth(["jwt"])
    public updateProperty(
        @Param("id") id: string,
        @Param("property") propertyName: string,
        obj: any,
        @User user?: JWTUser,
    ): Promise<T> {
        return super.doUpdateProperty(id, propertyName, obj, { user });
    }
}

export default UserRoute;
