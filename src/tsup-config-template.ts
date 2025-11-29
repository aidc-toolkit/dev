import { defineConfig } from "tsup";

export const tsupConfigAIDCToolkit = defineConfig((options) => {
    const developmentMode = options.define?.["mode"] === "dev";

    return {
        name: "aidc-toolkit",
        entry: ["src/index.ts"],
        format: ["esm", "cjs"],
        dts: true,
        minify: !developmentMode,
        sourcemap: developmentMode,
        clean: true
    };
});
