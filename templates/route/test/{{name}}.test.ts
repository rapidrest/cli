///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import config from "./config";
import { request } from "@rapidrest/service-core/dist/lib/test/request.js";
import { Server, ObjectFactory  } from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as uuid from "uuid";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "rrst-test",
    },
});

describe("Auth Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server(config, "./src", logger, objectFactory);
    const baseUrl = "{{path}}";

    beforeAll(async () => {
        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        await objectFactory.destroy();
    });

    it("Can make hello request.", async () => {
        const result = await request(server.getApplication())
            .get(baseUrl);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        expect(result.body).toBe("Hello World!");
    });

    it("Can make authenticated hello request.", async () => {
        const user = {
            uid: uuid.v4(),
            name: "Kermit the Frog"
        };
        const token = JWTUtils.createTokenSync(config.get("auth", user));
        const result = await request(server.getApplication())
            .get(baseUrl)
            .set("Authorization", "jwt " + token);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        expect(result.body).toBe("Hello World!");
    });
});
