///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import config from "../config.js";
import { request } from "@rapidrest/service-core/dist/lib/test/request.js";
import { Server, ConnectionManager, ACLRecord, ObjectFactory, MongoConnection, MongoRepository } from "@rapidrest/service-core";
import { EventUtils, JWTUtils, Logger } from "@rapidrest/core";
import { MongoMemoryServer } from "mongodb-memory-server";
import User, { UserStatus } from "../../src/models/User.js";
import { v4 as uuidv4 } from "uuid";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "rrst-test",
    },
});

describe("User Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server(config, "./src", logger, objectFactory);
    const baseUrl = "/user";

    const admin: any = {
        uid: uuidv4(),
        roles: config.get("trusted_roles"),
    };
    const adminToken = JWTUtils.createTokenSync(config.get("auth"), admin);
    let user: any = undefined;
    let authToken: any = undefined;
    let repo: MongoRepository<User>;
    let aclRepo: MongoRepository<any>;

    const createUser = async function(data?: any): Promise<User> {
        const obj: User = new User({
            name: "tutone",
            firstName: "Tommy",
            lastName: "Tutone",
            email: "tommy.tutone@gmail.com",
            password: "password",
            phone: "555-867-5309",
            userStatus: UserStatus.OFFLINE,
            ...data
        });

        const result: User = await repo.save(obj);

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
            read: false,
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
            parentUid: "User"
        };
        await aclRepo.save(acl);

        return result;
    }

    const createUsers = async function(num: number, data?: any): Promise<User[]> {
        const results: User[] = [];

        for (let i = 0; i < num; i++) {
            results.push(await createUser({
                name: `${data?.name || "tutone"}#${i}`,
                ...data
            }));
        }

        return results;
    }

    beforeAll(async () => {
        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        let conn: any = connMgr?.connections.get("acl");
        if (conn instanceof MongoConnection) {
            aclRepo = conn.getMongoRepository("AccessControlListMongo");
        }
        conn = connMgr?.connections.get("mongo");
        if (conn instanceof MongoConnection) {
            repo = conn.getMongoRepository("User");
        } else {
            throw new Error("Could not find user connection");
        }
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        user = {
            uid: uuidv4(),
        };
        authToken = await JWTUtils.createToken(config.get("auth"), user);
        await EventUtils.init(config, logger, authToken);

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
        const objs: User[] = await createUsers(5);

        const result = await request(server.getApplication())
            .head(baseUrl)
            .set("Authorization", "jwt " + adminToken);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.headers).toHaveProperty("content-length");
        expect(result.headers["content-length"]).toBe((objs.length).toString());
    });

    it("Can make create request.", async () => {
        const obj: User = new User({
            name: "tutone",
            firstName: "Tommy",
            lastName: "Tutone",
            email: "tommy.tutone@gmail.com",
            password: "password",
            phone: "555-867-5309",
            userStatus: UserStatus.OFFLINE,
        });

        const result = await request(server.getApplication())
            .post(baseUrl)
            .send(obj);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        expect(result.body.name).toEqual(obj.name);
        expect(result.body.firstName).toEqual(obj.firstName);
        expect(result.body.lastName).toEqual(obj.lastName);
        expect(result.body.email).toEqual(obj.email);
        expect(result.body.phone).toEqual(obj.phone);
        expect(result.body.userStatus).toEqual(obj.userStatus);

        // Validate the contents were stored correctly
        const existing: User | null = await repo.findOne({uid: obj.uid} as any);
        expect(existing).toBeDefined();
        if (existing) {
            expect(existing.name).toEqual(obj.name);
            expect(existing.firstName).toEqual(obj.firstName);
            expect(existing.lastName).toEqual(obj.lastName);
            expect(existing.email).toEqual(obj.email);
            expect(existing.phone).toEqual(obj.phone);
            expect(existing.userStatus).toEqual(obj.userStatus);
        }
    });

    it("Can make delete request.", async () => {
        const obj: User = await createUser();
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
        const objs: User[] = await createUsers(5);

        const result = await request(server.getApplication())
            .get(baseUrl)
            .set("Authorization", "jwt " + adminToken);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        expect(result.body).toHaveLength(objs.length);
    });

    it("Can make findById request.", async () => {
        const obj: User = await createUser();
        const url = baseUrl + "/" + obj.uid;

        const result = await request(server.getApplication())
            .get(url)
            .set("Authorization", "jwt " + adminToken);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        expect(result.body.name).toEqual(obj.name);
        expect(result.body.firstName).toEqual(obj.firstName);
        expect(result.body.lastName).toEqual(obj.lastName);
        expect(result.body.email).toEqual(obj.email);
        expect(result.body.phone).toEqual(obj.phone);
        expect(result.body.userStatus).toEqual(obj.userStatus);

    });

    it("Can make truncate request.", async () => {
        const objs: User[] = await createUsers(5);
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
        const obj: User = await createUser();
        const url = baseUrl + "/" + obj.uid;
        obj.phone = "818-867-5309";

        const result = await request(server.getApplication())
            .put(url)
            .set("Authorization", "jwt " + adminToken)
            .send(obj);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        expect(result.body.name).toEqual(obj.name);
        expect(result.body.firstName).toEqual(obj.firstName);
        expect(result.body.lastName).toEqual(obj.lastName);
        expect(result.body.email).toEqual(obj.email);
        expect(result.body.phone).toEqual(obj.phone);
        expect(result.body.userStatus).toEqual(obj.userStatus);

        // Validate the contents were stored correctly
        const existing: User | null = await repo.findOne({uid: obj.uid} as any);
        expect(existing).toBeDefined();
        if (existing) {
            expect(existing.name).toEqual(obj.name);
            expect(existing.firstName).toEqual(obj.firstName);
            expect(existing.lastName).toEqual(obj.lastName);
            expect(existing.email).toEqual(obj.email);
            expect(existing.phone).toEqual(obj.phone);
            expect(existing.userStatus).toEqual(obj.userStatus);
        }
    });

    it.skip("Can make update property request.", async () => {
        const obj: User = await createUser();
        const url = baseUrl + "/" + obj.uid + "/phone";
        obj.phone = "818-867-5309";

        const result = await request(server.getApplication())
            .put(url)
            .set("Authorization", "jwt " + adminToken)
            .send(`"${obj.phone}"`);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        expect(result.body.name).toEqual(obj.name);
        expect(result.body.firstName).toEqual(obj.firstName);
        expect(result.body.lastName).toEqual(obj.lastName);
        expect(result.body.email).toEqual(obj.email);
        expect(result.body.phone).toEqual(obj.phone);
        expect(result.body.userStatus).toEqual(obj.userStatus);

        // Validate the contents were stored correctly
        const existing: User | null = await repo.findOne({uid: obj.uid} as any);
        expect(existing).toBeDefined();
        if (existing) {
            expect(existing.name).toEqual(obj.name);
            expect(existing.firstName).toEqual(obj.firstName);
            expect(existing.lastName).toEqual(obj.lastName);
            expect(existing.email).toEqual(obj.email);
            expect(existing.phone).toEqual(obj.phone);
            expect(existing.userStatus).toEqual(obj.userStatus);
        }
    });
});
