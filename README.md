# Development Package

The AIDC Toolkit `dev` package contains development artefacts only; it is not intended to be used as anything other than
a development dependency.

## TypeScript Configuration

All AIDC Toolkit packages are expected to be built the same way, which implies that they all have the same TypeScript
configuration. This is supported by the [`tsconfig.json` file](tsconfig.json) in this package. All changes should be managed
in that file, with other packages declaring their own `tsconfig.json` as follows:

```json
{
  "extends": "@aidc-toolkit/dev/tsconfig.json"
}
```

## ESLint Configuration

All AIDC Toolkit packages are expected to follow a common coding style (enforced by [ESLint](https://eslint.org/)),
which implies that they all have the same ESLint configuration. This is supported by the [`eslint.config.template.ts`
file](src/eslint.config.template.ts) in this package. All changes should be managed in that file, with other packages
declaring their own `eslint.config.js` file as follows:

```javascript
import tseslint from "typescript-eslint";
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import jsdoc from "eslint-plugin-jsdoc";
import esLintConfigLove from "eslint-config-love";
import { esLintConfigAIDCToolkit } from "@aidc-toolkit/dev";

export default tseslint.config(
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    stylistic.configs["recommended-flat"],
    jsdoc.configs["flat/recommended-typescript"],
    esLintConfigLove,
    esLintConfigAIDCToolkit
);
```

The ESLint configuration requires the installation of the following development dependencies:

- @eslint/js
- @stylistic/eslint-plugin
- eslint-config-love
- eslint-plugin-jsdoc
- typescript-eslint
