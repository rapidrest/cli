///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { ApiError, JWTUser, JWTUtils, ObjectDecorators } from "@rapidrest/core";
import {
    RouteDecorators,
    DocDecorators,
    ApiErrorMessages,
    RepoUtils,
    BasicStrategy,
    AuthMiddleware,
    ObjectFactory,
    BasicStrategyOptions
} from "@rapidrest/service-core";
import User, { UserStatus } from "../models/User.js";

const { Config, Init, Inject } = ObjectDecorators;
const { Summary, Description, Returns } = DocDecorators;
const {
    Auth,
    Get,
    Route,
} = RouteDecorators;
const AuthUser = RouteDecorators.User;

/**
 * Handles all REST API requests for the endpoint `/user/login`.
 * 
 * @author <AUTHOR>
 */
@Description("Handles all REST API requests for the endpoint `/user/login`.")
@Route("/")
class AuthRoute {
    @Inject(AuthMiddleware)
    private authMiddleware?: AuthMiddleware;

    @Config("auth")
    private jwtConfig?: any;

    @Inject(ObjectFactory)
    private objectFactory?: ObjectFactory;
    
    @Inject(RepoUtils, { name: User.name, args: [User] })
    protected userUtils?: RepoUtils<User>;

    /**
     * Called on server startup to initialize the route with any defaults.
     */
    @Init
    private async initialize() {
        if (!this.authMiddleware) {
            throw new Error("authMiddleware is not set.");
        }
        if (!this.objectFactory) {
            throw new Error("objectFactory is not set.");
        }

        const options: BasicStrategyOptions = new BasicStrategyOptions();
        options.verify = async (name: string, password: string): Promise<JWTUser | undefined> => {
            if (!this.userUtils) {
                throw new Error("User repository not set.");
            }

            let user: User | undefined = await this.userUtils.findOne(name);
            if (!user) {
                throw new Error("Invalid name or password");
            }

            if (user.password !== password) {
                throw new Error("Invalid name or password");
            }

            user = await this.userUtils.update({
                uid: user.uid,
                version: user.version,
                userStatus: UserStatus.ONLINE
            }, user, { ignoreACL: true });

            return user;
        };
        const strategy: BasicStrategy = await this.objectFactory.newInstance(BasicStrategy, {
            name: "default",
            args: [options],
        });
        this.authMiddleware.register(strategy.name, strategy);
    }

    /**
     * Authenticates the user using HTTP Basic and returns a JSON Web Token access token to be used with future API requests.
     */
    @Summary("login")
    @Description("Authenticates the user using HTTP Basic and returns a JSON Web Token access token to be used with future API requests.")
    @Returns([any])
    @Auth(["basic"])
    @Get("/user/login")
    private async login(@AuthUser user: JWTUser): Promise<any> {
        if (!user) {
            throw new ApiError(ApiErrorMessages.AUTH_FAILED, 401, "Invalid user or password.");
        }

        const token: string = await JWTUtils.createToken(this.jwtConfig, user);
        return new {
            token
        };
    }

    /**
     * Logs out the current user
     */
    @Summary("logout")
    @Description("Logs out the current user.")
    @Returns([null])
    @Auth(["jwt"])
    @Get("/user/logout")
    private async logout(@AuthUser user: JWTUser): Promise<void> {
        if (!this.userUtils) {
            throw new Error("User repository not set.");
        }
        
        let foundUser: User | undefined = await this.userUtils.findOne(user.uid);
        if (!foundUser) {
            throw new ApiError(ApiErrorMessages.NOT_FOUND, 404, "User not found.");
        }

        await this.userUtils.update({
            uid: foundUser.uid,
            version: foundUser.version,
            userStatus: UserStatus.OFFLINE
        }, foundUser, { ignoreACL: true });
    }
}

export default AuthRoute;
