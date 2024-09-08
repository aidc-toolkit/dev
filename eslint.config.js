import tseslint from "typescript-eslint"
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import jsdoc from "eslint-plugin-jsdoc";
import esLintConfigLove from "eslint-config-love";
import { esLintConfigAIDCToolkit } from "./dist/index.js";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    stylistic.configs["recommended-flat"],
    jsdoc.configs["flat/recommended-typescript"],
    esLintConfigLove,
    esLintConfigAIDCToolkit
);
