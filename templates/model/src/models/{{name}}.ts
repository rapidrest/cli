///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BaseMongoEntity, DocDecorators, ModelDecorators, PersistenceDecorators } from "@rapidrest/service-core";
const { Column, Entity, Index } = PersistenceDecorators;
const { Cache, DataStore, Identifier, Protect } = ModelDecorators;
const { Description } = DocDecorators;

/**
 * {{description}}
 *
 * @author {{author}}
 */
@Description("")
@Entity({ collation: { locale: "en", strength: 2 }})
@DataStore("{{datastore}}")
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
@Cache()
export default class {{name}} extends BaseMongoEntity {
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
