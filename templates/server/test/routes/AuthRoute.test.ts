///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import config from "../config.js";
import { request } from "@rapidrest/service-core/dist/lib/test/request.js";
import { Server, ConnectionManager, ObjectFactory, ACLRecord, MongoConnection, MongoRepository } from "@rapidrest/service-core";
import { JWTUtils, Logger } from "@rapidrest/core";
import { MongoMemoryServer } from "mongodb-memory-server";
import User, { UserStatus } from "../../src/models/User.js";

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
    const baseUrl = "/user/login";
    let aclRepo: MongoRepository<any>;
    let userRepo: MongoRepository<User>;

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

        const result: User = await userRepo.save(obj);

        const records: ACLRecord[] = [];

        // Owner has CRUD access
        records.push({
            userOrRoleId: obj.uid,
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
            userRepo = conn.getMongoRepository("User");
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
        try {
            await userRepo.clear();
        } catch (err) {
            // The error "ns not found" occurs when the collection doesn't exist yet. We can ignore this error.
            if (err.message !== "ns not found") {
                throw err;
            }
        }
    });

    it("Can make login request.", async () => {
        const user: User = await createUser();
        const result = await request(server.getApplication())
            .get(baseUrl)
            .set("Authorization", "basic " + Buffer.from(`${user.name}:password`).toString("base64"));

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.body).toBeDefined();
        expect(result.body).toHaveProperty("token");

        const existing: User | null = await userRepo.findOne({ uid: user.uid } as any);
        if (existing) {
            expect(existing.userStatus).toEqual(UserStatus.ONLINE);
        }
    });

    it("Can make logout request.", async () => {
        const user: User = await createUser();
        const authToken = await JWTUtils.createToken(config.get("auth"), user);
        const url = "/user/logout";

        const result = await request(server.getApplication())
            .get(url)
            .set("Authorization", "jwt " + authToken);

        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);

        const existing: User | null = await userRepo.findOne({ uid: user.uid } as any);
        if (existing) {
            expect(existing.userStatus).toEqual(UserStatus.OFFLINE);
        }
    });
});
