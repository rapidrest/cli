///////////////////////////////////////////////////////////////////////////////
// Copyright (C) {{year}} {{author}}
///////////////////////////////////////////////////////////////////////////////
import { BaseMongoEntity, DocDecorators, ModelDecorators, PersistenceDecorators } from "@rapidrest/service-core";
const { Column, Entity, Index } = PersistenceDecorators;
const { Cache, DataStore, Identifier, Protect } = ModelDecorators;
const { Description } = DocDecorators;

export enum UserStatus {
    OFFLINE = "OFFLINE",
    ONLINE = "ONLINE"
}

/**
 * An example model class describing an authenticated user.
 *
 * @author {{author}}
 */
@Description("An example model class describing an authenticated user.")
@Entity({ collation: { locale: "en", strength: 2 }})
@DataStore("mongo")
@Protect(
    {
        uid: "User",
        records: [
            {
                userOrRoleId: "anonymous",
                create: true,
                read: false,
                update: false,
                delete: false,
                special: false,
                full: false,
            },
            {
                userOrRoleId: ".*",
                create: false,
                read: false,
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
export default class User extends BaseMongoEntity {
    /**
     * 
     */
    @Description("")
    @Identifier
    @Index()
    @Column()
    public name: string = "";

    /**
     * 
     */
    @Description("")
    @Column()
    public firstName: string | undefined = undefined;

    /**
     * 
     */
    @Description("")
    @Column()
    public lastName: string | undefined = undefined;

    /**
     * 
     */
    @Description("")
    @Column()
    public email: string = "";

    /**
     * 
     */
    @Description("")
    @Column()
    public password: string = "";

    /**
     * 
     */
    @Description("")
    @Column()
    public phone: string | undefined = undefined;

    /**
     * User Status
     */
    @Description("")
    @Column()
    public userStatus: UserStatus = UserStatus.OFFLINE;

    /**
     * 
     */
    @Description("")
    @Column()
    public roles: string[] = [];

    constructor(other?: any) {
        super(other);
        
        if (other) {
            this.name = "name" in other ? other.name.trim() : this.name;
            this.firstName = "firstName" in other ? other.firstName.trim() : this.firstName;
            this.lastName = "lastName" in other ? other.lastName.trim() : this.lastName;
            this.email = "email" in other ? other.email.trim() : this.email;
            this.password = "password" in other ? other.password.trim() : this.password;
            this.phone = "phone" in other ? other.phone.trim() : this.phone;
            this.userStatus = "userStatus" in other ? other.userStatus : this.userStatus;
            this.roles = "roles" in other ? other.roles : this.roles;
        }
    }
}
