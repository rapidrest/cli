///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { ReactService } from "@rapidrest/react";

/**
 * Provides DI-compatible server side fetching of data/props for the React app
 * {{app}}'s {{name}} page. 
 * 
 * @author {{author}}
 */
@ReactService("{{app}}/{{name}}")
export default class {{className}}Service {
    public async fetchProps(): Promise<any> {
        return {};
    }
}