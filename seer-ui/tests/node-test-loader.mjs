import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ts from "typescript";

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, "src");
const exts = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function resolveWithExt(basePath) {
  if (fsSync.existsSync(basePath) && fsSync.statSync(basePath).isFile()) {
    return basePath;
  }

  for (const ext of exts) {
    const candidate = `${basePath}${ext}`;
    if (fsSync.existsSync(candidate) && fsSync.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  for (const ext of exts) {
    const indexCandidate = path.join(basePath, `index${ext}`);
    if (fsSync.existsSync(indexCandidate) && fsSync.statSync(indexCandidate).isFile()) {
      return indexCandidate;
    }
  }

  return null;
}

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("@/")) {
    const mapped = resolveWithExt(path.join(srcRoot, specifier.slice(2)));
    if (!mapped) {
      throw new Error(`Unable to resolve alias path: ${specifier}`);
    }
    return {
      url: pathToFileURL(mapped).href,
      shortCircuit: true,
    };
  }

  if (specifier.endsWith(".css")) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : projectRoot;
    const cssPath = path.resolve(path.dirname(parentPath), specifier);
    return {
      url: pathToFileURL(cssPath).href,
      shortCircuit: true,
    };
  }

  return defaultResolve(specifier, context, defaultResolve);
}

export async function load(url, context, defaultLoad) {
  if (url.endsWith(".css")) {
    return {
      format: "module",
      shortCircuit: true,
      source: "export default {};",
    };
  }

  if (url.endsWith(".ts") || url.endsWith(".tsx") || url.endsWith(".mts") || url.endsWith(".cts")) {
    const sourceText = await fs.readFile(fileURLToPath(url), "utf8");
    const transpiled = ts.transpileModule(sourceText, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      fileName: fileURLToPath(url),
      reportDiagnostics: false,
    });

    return {
      format: "module",
      shortCircuit: true,
      source: transpiled.outputText,
    };
  }

  return defaultLoad(url, context, defaultLoad);
}
