#!/usr/bin/env node
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { fileURLToPath } from "url";
import { dirname } from "path";
import config from "./config.js";
import { JWTUtils, EventUtils, Logger } from "@rapidrest/core";
import { ObjectFactory, Server } from "@rapidrest/service-core";

import * as fs from "fs";
import { readFile } from "fs/promises";
import * as os from "os";

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

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

    // Initialize EventUtils to be able to send out telemetry events
    const auth: any = config.get("auth");
    delete auth.options.expiresIn;
    const token: string = await JWTUtils.createToken(auth,
        {
            uid: `${config.get("service_name")}-${os.hostname()}`,
            name: `${config.get("service_name")}-${os.hostname()}`,
            roles: config.get("trusted_roles"),
        });
    await EventUtils.init(config, logger, token);

    // Create and start the server
    server = new Server({ config, basePath: _dirname, logger, objectFactory });
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
