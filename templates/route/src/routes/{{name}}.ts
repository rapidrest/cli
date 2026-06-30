///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { JWTUser, ObjectDecorators } from "@rapidrest/core";
import {
    RouteDecorators,
    DocDecorators,
} from "@rapidrest/service-core";

const { Init } = ObjectDecorators;
const { Summary, Description, Returns } = DocDecorators;
const {
    Get,
    Route,
    User
} = RouteDecorators;

/**
 * {{description}}
 * 
 * @author {{author}}
 */
@Description("{{description}}")
@Route("{{path}}")
export default class {{name}} {
    /**
     * Called on server startup to initialize the route with any defaults.
     */
    @Init
    private async initialize() {
        // TODO
    }

    /**
     * Sends a friendly greeting to the user.
     */
    @Summary("login")
    @Description("Sends a friendly greeting to the user.")
    @Returns([string])
    @Get()
    private async hello(@User user?: JWTUser): Promise<string> {
        return `Hello ${user ? user.name : 'World'}!`;
    }
}