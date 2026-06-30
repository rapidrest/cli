import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["test/**/*.test.ts"],
        fileParallelism: false,
        pool: "forks",
        forks: {
            execArgv: ["--no-experimental-strip-types"],
        },
        clearMocks: true,
        coverage: {
            enabled: true,
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["**/node_modules/**", "**/test/**", "**/templates/**"],
            reporter: ["text", "json", "html", "lcov"],
            thresholds: {
                branches: 0,
                functions: 0,
                lines: 0,
                statements: 0,
            },
            reportsDirectory: "coverage",
        },
        reporters: ["default", "junit"],
        outputFile: {
            junit: "junit.xml",
        },
        disableConsoleIntercept: true
    },
});
