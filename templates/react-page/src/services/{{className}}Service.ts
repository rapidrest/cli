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
@ReactService("{{name}}")
export default class {{name}}Service {
    public async fetchProps(): Promise<any> {
        return {};
    }
}