///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { ACLAction, Base{{#if (eq datastoreType "mongodb")}}Mongo{{/if}}Entity, DocDecorators, ModelDecorators, PersistenceDecorators } from "@rapidrest/service-core";
{{#if hasOptionalProperty}}
import { ObjectDecorators } from "@rapidrest/core";
const { Nullable } = ObjectDecorators;
{{/if}}
const { Column, Entity, Index } = PersistenceDecorators;
const { Cache, DataStore, Identifier, Protect } = ModelDecorators;
const { Description } = DocDecorators;

/**
 * {{description}}
 *
 * @author {{author}}
 */
@Description("{{description}}")
@Entity({{#if (eq datastoreType "mongodb")}}{ collation: { locale: "en", strength: 2 }}{{/if}})
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
                actions: [ACLAction.READ, ACLAction.LIST, ACLAction.COUNT, ACLAction.EXISTS],
            },
            {
                userOrRoleId: ".*",
                actions: [ACLAction.READ, ACLAction.LIST, ACLAction.COUNT, ACLAction.EXISTS],
            }
        ]
    },
    true
)
{{/if}}
{{#if cache}}
@Cache({{cache}})
{{/if}}
export default class {{name}} extends Base{{#if (eq datastoreType "mongodb")}}Mongo{{/if}}Entity {
    /**
     * The unique name of the {{name}}.
     */
    @Description("The unique name of the {{name}}.")
    @Identifier
    @Index()
    @Column()
    public name: string = "";
{{#each properties}}

    /**
     * {{this.description}}
     */
    @Description("{{this.description}}")
    @Column()
    {{#if this.optional}}@Nullable
    {{/if}}public {{this.name}}: {{this.type}}{{#if this.optional}} | undefined{{/if}} = {{this.defaultValue}};
{{/each}}

    constructor(other?: any) {
        super(other);

        if (other) {
            this.name = "name" in other ? other.name.trim() : this.name;
{{#each properties}}
            this.{{this.name}} = "{{this.name}}" in other ? other.{{this.name}} : this.{{this.name}};
{{/each}}
        }
    }
}
