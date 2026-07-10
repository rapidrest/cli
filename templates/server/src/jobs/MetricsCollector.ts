///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BackgroundService } from "@rapidrest/service-core";
import * as prom from "prom-client";

/**
 * The `MetricsCollector` provides a background service for collecting Prometheseus metrics for consumption by external
 * clients and compatible servers using the built-in `MetricsRoute` route handler.
 *
 * @author Jean-Philippe Steinmetz <info@acceleratxr.com>
 */
export default class MetricsCollector extends BackgroundService {
    private registry: prom.Registry;

    constructor() {
        super();
        this.registry = prom.register;
    }

    public get schedule(): string | undefined {
        return "* * * * *";
    }

    public run(): void {
        // TODO
    }

    public async start(): Promise<void> {
        // TODO
    }

    public async stop(): Promise<void> {
        // TODO
    }
}
