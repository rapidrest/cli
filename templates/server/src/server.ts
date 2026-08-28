#!/usr/bin/env node
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import config from "./config.js";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { JWTUtils, EventUtils, Logger } from "@rapidrest/core";
import { ObjectFactory, Server } from "@rapidrest/service-core";

import * as fs from "fs";
import { readFile } from "fs/promises";
import * as os from "os";
import { assertProductionSecretsAreSet } from "./config.defaults.js";

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

assertProductionSecretsAreSet(config, process.env.environment);

const logLevel: string = config.get("logger:level") || (process.env.environment === "production" ? "info" : "debug");
const logger = Logger(logLevel, config.get("logger:file"));
console.log("Log Level=" + logLevel);

const objectFactory = new ObjectFactory(config, logger);
let server: any = undefined;

const start = async function (config: any, logger: any) {
    // Load the release notes file
    let releaseNotes: string | undefined = undefined;
    try {
        if (fs.existsSync(`${_dirname}/../RELEASE_NOTES.rst`)) {
            releaseNotes = await readFile(`${_dirname}/../RELEASE_NOTES.rst`, { encoding: "utf-8" });
        }
    } catch (err) {
        logger.debug(err);
    }

    // Initialize EventUtils to be able to send out telemetry events. Build a standalone copy of the
    // auth config rather than mutating the object `config.get()` returns: nconf does not clone nested
    // values, so `config.get("auth")` returns the exact live object shared by every other consumer of
    // this config (e.g. `TokenUtils`) — deleting `expiresIn` off of it in place previously stripped
    // expiry from every access token the server issues, not just this one telemetry token.
    const configuredAuth: any = config.get("auth");
    const auth: any = { ...configuredAuth, options: { ...configuredAuth.options } };
    delete auth.options.expiresIn;
    const token: string = await JWTUtils.createToken(auth,
        {
            uid: `${config.get("service_name")}-${os.hostname()}`,
            roles: config.get("trusted_roles"),
            scopes: [],
        });
    await EventUtils.init(config, logger, token);

    // Create and start the server
    server = new Server({ config, basePath: config.get("base_path"), logger, objectFactory });
    await server.start();
};

void start(config, logger);

const shutdown = async () => {
    logger.info("Shutting down...");
    if (server) {
        await server.stop();
    }
    if (objectFactory) {
        await objectFactory.destroy();
    }
    process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
