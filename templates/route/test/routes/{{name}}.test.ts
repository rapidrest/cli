///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import config from "./config";
import { request } from "@rapidrest/service-core/dist/lib/test/request.js";
import {
    {{#if model}}
    ACLRecord,
    {{#if (eq datastoreType "mongodb")}}
    MongoConnection,
    MongoRepository,
    {{/if}}
    {{/if}}
    Server,
    ObjectFactory
} from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
{{#if model}}
import {{model}} from "../../src/models/{{model}}.js";
{{/if}}
{{#if (eq datastoreType "mongodb")}}
import { MongoMemoryServer } from "mongodb-memory-server";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "rrst-test",
    },
});
{{/if}}

describe("Route:{{name}} Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server(config, "./src", logger, objectFactory);
    const baseUrl = "{{path}}";
    {{#if model}}
    let repo: {{#if (eq datastoreType "mongodb")}}Mongo{{/if}}Repository<{{model}}>;
    let aclRepo: {{#if (eq datastoreType "mongodb")}}Mongo{{/if}}Repository<any>;
    
    const create{{model}} = async function(data?: any): Promise<{{model}}> {
        const obj: {{model}} = new {{model}}({
            ...data
        });

        const result: {{model}} = await repo.save(obj);

        const records: ACLRecord[] = [];

        // Owner has CRUD access
        records.push({
            userOrRoleId: user.uid,
            create: true,
            read: true,
            update: true,
            delete: true,
            special: false,
            full: false,
        });

        // Everyone has no access
        records.push({
            userOrRoleId: ".*",
            create: false,
            read: true,
            update: false,
            delete: false,
            special: false,
            full: false,
        });

        const acl: any = {
            uid: result.uid,
            dateCreated: new Date(),
            dateModified: new Date(),
            version: 0,
            records,
            parentUid: "{{model}}"
        };
        await aclRepo.save(acl);

        return result;
    }

    const create{{model}}s = async function(num: number, data?: any): Promise<{{model}}[]> {
        const results: {{model}}[] = [];

        for (let i = 0; i < num; i++) {
            results.push(await create{{model}}(data));
        }

        return results;
    }

    {{/if}}
    beforeAll(async () => {
        {{#if (eq datastoreType "mongodb")}}
        await mongod.start();
        {{/if}}
        await server.start();
        {{#if model}}
        
        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        let conn: any = connMgr?.connections.get("acl");
        {{#if (eq datastoreType "mongodb")}}
        if (conn instanceof MongoConnection) {
            aclRepo = conn.getMongoRepository("AccessControlListMongo");
        }
        {{else}}
        if (conn instanceof Connection) {
            aclRepo = conn.getRepository("AccessControlListSQL");
        }
        {{/if}}
        conn = connMgr?.connections.get("{{datastore}}");
        {{#if (eq datastoreType "mongodb")}}
        if (conn instanceof MongoConnection) {
            repo = conn.getMongoRepository("{{model}}");
        {{else}}
        if (conn instanceof Connection) {
            repo = conn.getRepository("{{model}}");
        {{/if}}
        } else {
            throw new Error("Could not find user connection");
        }
        {{/if}}
    });

    afterAll(async () => {
        await server.stop();
        {{#if (eq datastoreType "mongodb")}}
        await mongod.stop();
        {{/if}}
        await objectFactory.destroy();
    });
{{#if model}}

    beforeEach(async () => {
        try {
            await repo.clear();
        } catch (err) {
            // The error "ns not found" occurs when the collection doesn't exist yet. We can ignore this error.
            if (err.message !== "ns not found") {
                throw err;
            }
        }
    });

    it("Can make count request.", async () => {
        const objs: {{model}}[] = await create{{model}}s(5);

        const result = await request(server.getApplication())
            .head(baseUrl);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.headers).toHaveProperty("content-length");
        expect(result.headers["content-length"]).toBe((objs.length).toString());
    });

    it("Can make create request.", async () => {
        const obj: {{model}} = new {{model}}({
            // TODO
        });

        const result = await request(server.getApplication())
            .post(baseUrl)
            .set("Authorization", "jwt " + adminToken)
            .send(obj);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        for (const key in obj) {
            expect(result.body[key]).toEqual(obj[key]);
        }

        // Validate the contents were stored correctly
        const existing: {{model}} | null = await repo.findOne({uid: obj.uid} as any);
        expect(existing).toBeDefined();
        if (existing) {
            for (const key in obj) {
                expect(existing[key]).toEqual(obj[key]);
            }
        }
    });

    it("Can make delete request.", async () => {
        const obj: {{model}} = await create{{model}}();
        const url = baseUrl + "/" + obj.uid;

        const result = await request(server.getApplication())
            .delete(url)
            .set("Authorization", "jwt " + adminToken);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);

        // Validate the contents were removed
        const count: number = await repo.count({uid: obj.uid});
        expect(count).toBe(0);
    });

    it("Can make findAll request.", async () => {
        const objs: {{model}}[] = await create{{model}}s(5);

        const result = await request(server.getApplication())
            .get(baseUrl);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        expect(result.body).toHaveLength(objs.length);
        for (let i = 0; i < objs.length; i++) {
            const obj = objs[i];
            const other = result.body[i];
            for (const key in obj) {
                expect(other[key]).toEqual(obj[key]);
            }
        }
    });

    it("Can make findById request.", async () => {
        const obj: {{model}} = await create{{model}}();
        const url = baseUrl + "/" + obj.uid;

        const result = await request(server.getApplication())
            .get(url);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        for (const key in obj) {
            expect(result.body[key]).toEqual(obj[key]);
        }
    });

    it("Can make truncate request.", async () => {
        const objs: {{model}}[] = await create{{model}}s(5);
        let count: number = await repo.count();
        expect(count).toBe(objs.length);

        const result = await request(server.getApplication())
            .delete(baseUrl)
            .set("Authorization", "jwt " + adminToken);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);

        count = await repo.count();
        expect(count).toBe(0);
    });

    it("Can make update request.", async () => {
        const obj: {{model}} = await create{{model}}();
        const url = baseUrl + "/" + obj.uid;
        obj.status = {{model}}Status.ADOPTED;

        const result = await request(server.getApplication())
            .put(url)
            .set("Authorization", "jwt " + adminToken)
            .send(obj);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        for (const key in obj) {
            expect(result.body[key]).toEqual(obj[key]);
        }

        // Validate the contents were stored correctly
        const existing: {{model}} | null = await repo.findOne({uid: obj.uid} as any);
        expect(existing).toBeDefined();
        if (existing) {
            for (const key in obj) {
                expect(existing[key]).toEqual(obj[key]);
            }
        }
    });

    it("Can make update property request.", async () => {
        const obj: {{model}} = await create{{model}}();
        const url = baseUrl + "/" + obj.uid + "/status";
        obj.status = {{model}}Status.ADOPTED;

        const result = await request(server.getApplication())
            .put(url)
            .set("Authorization", "jwt " + adminToken)
            .send(obj.status);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        for (const key in obj) {
            expect(result.body[key]).toEqual(obj[key]);
        }

        // Validate the contents were stored correctly
        const existing: {{model}} | null = await repo.findOne({uid: obj.uid} as any);
        expect(existing).toBeDefined();
        if (existing) {
            for (const key in obj) {
                expect(existing[key]).toEqual(obj[key]);
            }
        }
    });
{{else}}

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
{{/if}}
});
