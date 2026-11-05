///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import config from "../config";
import { ObjectFactory } from "@rapidrest/service-core";
import { Logger } from "@rapidrest/core";
import {{name}} from "../../src/jobs/{{name}}.js";

describe("Job:{{name}} Tests", () => {
    const logger = Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    let job: {{name}};

    beforeAll(async () => {
        job = await objectFactory.newInstance({{name}}, { name: "default" });
    });

    afterAll(async () => {
        await objectFactory.destroy();
    });

    it("Has a schedule.", () => {
        expect(job.schedule).toBe("{{schedule}}");
    });

    it("Can start job.", async () => {
        await expect(Promise.resolve(job.start())).resolves.toBeUndefined();
    });

    it("Can execute job.", async () => {
        await expect(Promise.resolve(job.run())).resolves.toBeUndefined();
    });

    it("Can stop job.", async () => {
        await expect(Promise.resolve(job.stop())).resolves.toBeUndefined();
    });
});
