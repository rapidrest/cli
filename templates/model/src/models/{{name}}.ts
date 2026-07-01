///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { Base{{#eq datastoreType "mongodb"}}Mongo{{/if}}Entity, DocDecorators, ModelDecorators, PersistenceDecorators } from "@rapidrest/service-core";
const { Column, Entity, Index } = PersistenceDecorators;
const { Cache, DataStore, Identifier, Protect } = ModelDecorators;
const { Description } = DocDecorators;

/**
 * {{description}}
 *
 * @author {{author}}
 */
@Description("{{description}}")
@Entity({{#eq datastoreType "mongodb"}}{ collation: { locale: "en", strength: 2 }}{{/if}})
{{#if datastore}}
@DataStore("{{datastore}}")
{{/if}}
{{#if protect}}
@Protect(
    {
        uid: "{{name}}",
        records: [
            {
                userOrRoleId: "anonymous",
                create: false,
                read: true,
                update: false,
                delete: false,
                special: false,
                full: false,
            },
            {
                userOrRoleId: ".*",
                create: false,
                read: true,
                update: false,
                delete: false,
                special: false,
                full: false,
            }
        ]
    },
    true
)
{{/if}}
{{#if cache}}
@Cache()
{{/if}}
export default class {{name}} extends Base{{#eq datastoreType "mongodb"}}Mongo{{/if}}Entity {
    /**
     * The unique name of the {{name}}.
     */
    @Description("The unique name of the {{name}}.")
    @Identifier
    @Index()
    @Column()
    public name: string = "";

    constructor(other?: any) {
        super(other);
        
        if (other) {
            this.name = "name" in other ? other.name.trim() : this.name;
        }
    }
}
