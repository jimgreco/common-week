import { cp } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");

await cp(path.join(projectRoot, "public"), path.join(standaloneRoot, "public"), { recursive: true });
await cp(path.join(projectRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static"), { recursive: true });

await import(pathToFileURL(path.join(standaloneRoot, "server.js")).href);
