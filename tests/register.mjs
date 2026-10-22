// Test-only adapter: production identity stays entirely within the Sites dispatcher.
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../",import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return {shortCircuit:true,url:"data:text/javascript,export const env = new Proxy({}, {get: (_, key) => globalThis.__relayTestEnv?.[key]});"};
    if (specifier === "next/headers") return {shortCircuit:true,url:"data:text/javascript,export async function headers(){ return globalThis.__relayTestHeaders || new Headers(); }"};
    if (specifier === "next/navigation") return {shortCircuit:true,url:"data:text/javascript,export function redirect(){ throw new Error('Redirect'); }"};
    let location;
    if (specifier.startsWith("@/")) location = path.join(root,specifier.slice(2));
    else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) location = fileURLToPath(new URL(specifier,context.parentURL));
    if (location) {
      for (const suffix of ["",".ts",".tsx"]) if (existsSync(location+suffix)) return nextResolve(pathToFileURL(location+suffix).href,context);
    }
    return nextResolve(specifier,context);
  },
});
