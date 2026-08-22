#!/usr/bin/env node
///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { fileURLToPath } from "url";
import { dirname } from "path";
import config from "./config.js";
import { Logger } from "@rapidrest/core";
import { ObjectFactory } from "@rapidrest/service-core";
import { runStaticExport } from "@rapidrest/react";

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const logLevel: string = config.get("logger:level") || (process.env.environment === "production" ? "info" : "debug");
const logger = Logger(logLevel, config.get("logger:file"));

const objectFactory = new ObjectFactory(config, logger);

const result = await runStaticExport(
    { config, basePath: _dirname, logger, objectFactory },
    { appDir: "apps/{{name}}", routePrefix: "{{path}}" }
);
await objectFactory.destroy();

if (result.errors.length > 0) {
    for (const err of result.errors) {
        logger.error(`[export] ${err.path}: ${err.status ?? err.error}`);
    }
    console.error(`[export] Completed with ${result.errors.length} error(s).`);
    process.exit(1);
}

console.log(`[export] Wrote ${result.pages.length} page(s) to dist/export.`);
