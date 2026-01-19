import type { Options } from "tsup";

/**
 * Create common configuration for tsup, parameterized by development mode. If `options.define?.["mode"] === "dev"`,
 * tsup is running in development mode and will generate unminified, unbundled output with sourcemaps.
 *
 * @param options
 * Initial options.
 *
 * @returns
 * Updated options.
 */
export function tsupConfig(options: Options): Options {
    // Mode isn't set for production build.
    const developmentMode = options.define?.["build"] !== undefined;

    return {
        ...options,
        name: "aidc-toolkit",
        tsconfig: "./tsconfig-src.json",
        entry: ["src/index.ts"],
        format: ["esm", "cjs"],
        dts: true,
        minify: !developmentMode,
        sourcemap: developmentMode,
        clean: true
    };
}
