///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import config from "./config";
import { ObjectFactory } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import {{name}} from "../../src/jobs/{{name}}.js";

describe("Job:{{name}} Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);

    beforeAll(async () => {
    });

    afterAll(async () => {
        await objectFactory.destroy();
    });

    it("Can start job.", async () => {
    });

    it("Can stop job.", async () => {
    });

    it("Can execute job on schedule.", async () => {
    });
});
