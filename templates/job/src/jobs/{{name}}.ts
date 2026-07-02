///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BackgroundService } from "@rapidrest/service-core";

/**
 * {{description}}
 *
 * @author {{author}}
 */
export default class {{name}} extends BackgroundService {
    constructor(config: any, logger: any) {
        super(config, logger);
    }

    public get schedule(): string | undefined {
        return "{{schedule}}";
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
