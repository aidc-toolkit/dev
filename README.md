# Development Package

The AIDC Toolkit `dev` package contains development artefacts only; it is not intended to be used as anything other than
a development dependency.

## TypeScript Configuration

All AIDC Toolkit packages are expected to be built the same way, which implies that they all have the same TypeScript
configuration. This is supported by the [`tsconfig.json` file](tsconfig.json) in this package. Core changes should be managed
in that file, with other packages declaring their own `tsconfig.json` as follows:

```json
{
  "extends": "@aidc-toolkit/dev/tsconfig.json"
}
```

Options specific to the package may override or supplement core options if required.

## ESLint Configuration

All AIDC Toolkit packages are expected to follow a common coding style (enforced by [ESLint](https://eslint.org/)),
which implies that they all have the same ESLint configuration. This is supported by the [`eslint-config-template.ts`
file](src/eslint-config-template.ts) in this package. Core changes should be managed in that file, with other packages
declaring their own `eslint.config.js` file as follows:

```javascript
import { esLintConfigAIDCToolkit } from "@aidc-toolkit/dev";

export default esLintConfigAIDCToolkit;
```

Rules specific to the package may override or supplement core rules if required. If so, the `eslint.config.js` file
should be declared as follows:

```javascript
import tseslint from "typescript-eslint";
import { esLintConfigAIDCToolkit } from "@aidc-toolkit/dev";
// Additional imports here as required.
// ...

export default tseslint.config(
    ...esLintConfigAIDCToolkit,
    // Additional rules here as required.
    // ...
);
```

ESLint requires the installation of the `eslint` package as a development dependency. Other development dependencies may
be required if overriding or supplementing the core rules.
