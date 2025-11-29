# Development Package

**Copyright © 2024-2025 Dolphin Data Development Ltd. and AIDC Toolkit contributors**

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.

## Overview

> [!WARNING]
> 
> **This software is in beta**, with production release is scheduled for 2025Q4. To follow the status of this and other projects, go to the AIDC Toolkit [projects](https://github.com/orgs/aidc-toolkit/projects) page.

The AIDC Toolkit `dev` package contains development artefacts only; it is not intended to be used as anything other than a development dependency.

## TypeScript Configuration

All AIDC Toolkit packages are expected to be built the same way, which implies that they all have the same TypeScript configuration. This is supported by the [`tsconfig.json` file](tsconfig.json) in this package. Core changes should be managed in that file, with other packages declaring their own `tsconfig.json` as follows:

```json
{
  "extends": "@aidc-toolkit/dev/tsconfig.json"
}
```

Options specific to the package may override or supplement the default options if required.

## tsup Configuration

AIDC Toolkit library packages are bundled using [tsup](https://tsup.egoist.dev). This is supported by the [`tsup-config-template.ts` file](src/tsup-config-template.ts) in this package. Core changes should be managed in that file, with other packages declaring their own `tsup.config.ts` file as follows:

```typescript
import { tsupConfigAIDCToolkit } from "@aidc-toolkit/dev";

export default tsupConfigAIDCToolkit;
```

Options specific to the package may override or supplement the default options if required.If so, the `tsup.config.ts` file should be declared as follows:

```typescript
import { tsupConfigAIDCToolkit } from "@aidc-toolkit/dev";
import { defineConfig } from "tsup";
// Additional imports here as required.
// ...

export default defineConfig([
    tsupConfigAIDCToolkit,
    // Additional options here as required.
    // ...
]);
```

## ESLint Configuration

All AIDC Toolkit packages are expected to follow a common coding style, enforced by [ESLint](https://eslint.org/), which implies that they all have the same ESLint configuration. This is supported by the [`eslint-config-template.ts` file](src/eslint-config-template.ts) in this package. Core changes should be managed in that file, with other packages declaring their own `eslint.config.ts` file as follows:

```typescript
import { esLintConfigAIDCToolkit } from "@aidc-toolkit/dev";

export default esLintConfigAIDCToolkit;
```

Rules specific to the package may override or supplement the default rules if required. If so, the `eslint.config.ts` file should be declared as follows:

```typescript
import { esLintConfigAIDCToolkit } from "@aidc-toolkit/dev";
import { defineConfig } from "eslint/config";
// Additional imports here as required.
// ...

export default defineConfig([
    ...esLintConfigAIDCToolkit,
    // Additional rules here as required.
    // ...
]);
```
