#!/usr/bin/env node
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);
const pkg = _require("../package.json");
const version = pkg.version;

// Update the values.yaml file with the correct image tag
const valuesPath = join(__dirname, "..", "helm", "values.yaml");
const values = yaml.load(readFileSync(valuesPath, "utf8"));
values.service.image.tag = version;
writeFileSync(valuesPath, yaml.dump(values), "utf8");

// Update the version in the single_node_install.sh script
const scriptRegex = /VERSION="?\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b"?/g;
const scriptPath = join(__dirname, "k3s_install.sh");
const script = readFileSync(scriptPath, { encoding: "utf-8" });
let updated = script.replace(scriptRegex, `VERSION="${version}"`);
writeFileSync(scriptPath, updated, { encoding: "utf-8" });

// Also update the example in the README with the correct tag
const readmeRegex = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b/g;
const readmePath = join(__dirname, "..", "README.md");
const readme = readFileSync(readmePath, { encoding: "utf-8" });
updated = readme.replace(readmeRegex, version);
writeFileSync(readmePath, updated, { encoding: "utf-8" });

console.log(`Updated Helm values.yaml to version ${version}`);
