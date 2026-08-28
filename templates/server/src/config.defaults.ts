///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Default secret values used by `config.ts` for local development convenience.
 * Shared here (rather than duplicated in each config file) so `assertProductionSecretsAreSet()` can
 * compare the effective runtime config against the exact same values it's guarding against in
 * production.
 */
export const DEFAULT_COOKIE_SECRET = "f0fLSKFJLKWJFe09f32joff098u2fOFIWJ32890fnfnlak";
export const DEFAULT_AUTH_SECRET = "MyPasswordIsSecure";
export const DEFAULT_SESSION_SECRET = "SessionsHaveSecrets";

/** Minimal shape of the `nconf` config object this guard needs — matches `config.ts`'s export. */
export interface SecretsConfig {
    get(key: string): unknown;
}

/**
 * Refuses to let the server start in production with any of the checked-in development default
 * secrets (`cookie_secret`, `auth:secret`, `session:secret`) still in effect — they're visible to
 * anyone who reads this public repo, so leaving one unset in production would let an attacker forge
 * JWTs/sessions/cookies outright.
 *
 * @param config The loaded runtime configuration to check.
 * @param environment The deployment environment (typically `process.env.environment`). A no-op unless
 * this is exactly `"production"`.
 * @throws If any of the guarded secrets still hold its known default value in production.
 */
export function assertProductionSecretsAreSet(config: SecretsConfig, environment: string | undefined): void {
    if (environment !== "production") {
        return;
    }

    const insecureDefaults: Array<{ envVar: string; value: unknown; expected: string }> = [
        { envVar: "COOKIE_SECRET", value: config.get("cookie_secret"), expected: DEFAULT_COOKIE_SECRET },
        { envVar: "AUTH__SECRET", value: config.get("auth:secret"), expected: DEFAULT_AUTH_SECRET },
        { envVar: "SESSION__SECRET", value: config.get("session:secret"), expected: DEFAULT_SESSION_SECRET },
    ].filter((entry) => entry.value === entry.expected);

    if (insecureDefaults.length > 0) {
        const names: string = insecureDefaults.map((entry) => entry.envVar).join(", ");
        throw new Error(
            `Refusing to start in production with the default development secret(s) still in effect: ${names}. ` +
                "Set the corresponding environment variable(s) to a unique, secret value before deploying.",
        );
    }
}
