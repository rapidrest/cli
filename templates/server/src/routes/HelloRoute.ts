///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { JWTUser } from "@rapidrest/core";
import {
    RouteDecorators,
    DocDecorators,
} from "@rapidrest/service-core";

const { Summary, Description, Returns } = DocDecorators;
const {
    Get,
    Route,
    User
} = RouteDecorators;

/**
 * An example hello world that greets the user at `/hello`.
 * 
 * @author {{author}}
 */
@Description("An example route that greets the user at `/hello`.")
@Route("/hello")
export default class HelloRoute {
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
}