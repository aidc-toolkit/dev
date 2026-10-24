import type { ConfigObject } from "@eslint/core";
import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import esLintConfigLove from "eslint-config-love";
import jsdoc from "eslint-plugin-jsdoc";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

/**
 * ESLint profiles.
 */
export const ESLintProfiles = {
    /**
     * Test.
     */
    Test: "Test",

    /**
     * React.
     */
    React: "React"
} as const;

/**
 * ESLint profile key.
 */
export type ESLintProfileKey = keyof typeof ESLintProfiles;

/**
 * ESLint profile.
 */
export type ESLintProfile = typeof ESLintProfiles[ESLintProfileKey];

const ignoreDistConfig: ConfigObject = {
    ignores: ["dist"]
};

const basicConfig: ConfigObject = {
    languageOptions: {
        parserOptions: {
            projectService: true
        }
    },

    linterOptions: {
        reportUnusedDisableDirectives: "error"
    }
};

const recommendedConfigs: ConfigObject[] = [
    esLintConfigLove,
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    stylistic.configs.recommended,
    jsdoc.configs["flat/recommended-tsdoc-error"]
];

const overrideRecommendedConfig: ConfigObject = {
    rules: {
        "complexity": "off",
        "max-depth": ["error", 10],
        "max-lines": "off",
        "no-negated-condition": "off",
        "no-plusplus": "off",

        // Handled by @typescript-eslint/no-unused-vars.
        "no-unused-vars": "off",

        "require-unicode-regexp": ["error", {
            requireFlag: "u"
        }],

        "@typescript-eslint/class-literal-property-style": "off",
        "@typescript-eslint/class-methods-use-this": "off",
        "@typescript-eslint/init-declarations": "off",
        "@typescript-eslint/max-params": "off",
        "@typescript-eslint/no-empty-function": "off",
        "@typescript-eslint/no-empty-object-type": "off",
        "@typescript-eslint/no-magic-numbers": "off",
        "@typescript-eslint/no-unnecessary-type-parameters": "off",
        "@typescript-eslint/no-unused-vars": ["error", {
            argsIgnorePattern: "^_",
            varsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_"
        }],
        "@typescript-eslint/prefer-destructuring": "off",
        "@typescript-eslint/restrict-template-expressions": "off",
        "@typescript-eslint/unbound-method": ["error", {
            ignoreStatic: true
        }],

        "@stylistic/array-bracket-newline": ["error", "consistent"],
        "@stylistic/brace-style": ["error", "1tbs", {
            allowSingleLine: false
        }],
        "@stylistic/comma-dangle": ["error", "never"],
        "@stylistic/generator-star-spacing": ["error", {
            before: true,
            after: true
        }],
        "@stylistic/indent": ["error", 4],
        "@stylistic/indent-binary-ops": ["error", 4],
        "@stylistic/member-delimiter-style": ["error", {
            multiline: {
                delimiter: "semi",
                requireLast: true
            },
            singleline: {
                delimiter: "semi"
            }
        }],
        "@stylistic/no-trailing-spaces": ["off"],
        "@stylistic/operator-linebreak": ["error", "after"],
        "@stylistic/quotes": ["error", "double"],
        "@stylistic/semi": ["error", "always"],
        "@stylistic/object-curly-newline": ["error", {
            ObjectExpression: {
                multiline: true,
                minProperties: 1
            },
            ObjectPattern: {
                multiline: true,
                minProperties: 1
            }
        }],
        "@stylistic/object-property-newline": "error",
        "@stylistic/yield-star-spacing": ["error", {
            before: true,
            after: true
        }],

        "jsdoc/no-multi-asterisks": ["warn", {
            allowWhitespace: true
        }],
        "jsdoc/require-description": ["warn", {
            contexts: ["ClassDeclaration", "ClassProperty", "FunctionDeclaration", "MethodDefinition", "TSEnumDeclaration", "TSInterfaceDeclaration", "TSMethodSignature", "TSModuleDeclaration", "TSPropertySignature", "TSTypeAliasDeclaration"]
        }],
        "jsdoc/require-jsdoc": ["warn", {
            contexts: ["ClassDeclaration", "ClassProperty", "FunctionDeclaration", "MethodDefinition", "TSEnumDeclaration", "TSInterfaceDeclaration", "TSMethodSignature", "TSModuleDeclaration", "TSPropertySignature", "TSTypeAliasDeclaration"]
        }],
        "jsdoc/require-returns": ["warn", {
            checkGetters: false
        }],
        "jsdoc/require-yields-type": "off",
        "jsdoc/tag-lines": ["warn", "any", {
            count: 1,
            startLines: 1
        }]
    }
};

const testConfig: ConfigObject = {
    files: [
        "test/**/*"
    ],

    rules: {
        "max-nested-callbacks": "off",
        "jsdoc/require-jsdoc": "off",
        "@typescript-eslint/dot-notation": "off",
        "@typescript-eslint/no-unsafe-type-assertion": "off"
    }
};

const reactBasicConfig: ConfigObject = {
    languageOptions: {
        globals: globals.browser
    }
};

const reactRecommendedConfigs: ConfigObject[] = [
    reactHooks.configs.flat.recommended,
    reactRefresh.configs.vite
];

const reactOverrideRecommendedConfig: ConfigObject = {
    rules: {
        "no-console": ["error", {
            allow: ["error"]
        }],

        "@stylistic/jsx-closing-bracket-location": "off",
        "@stylistic/jsx-closing-tag-location": "off",
        "@stylistic/jsx-curly-spacing": [
            "error",
            {
                when: "never",
                children: true
            }
        ],
        "@stylistic/jsx-indent-props": ["error", 4],
        "@stylistic/jsx-wrap-multilines": "off"
    }
};

const esLintProfileConfigs: Record<ESLintProfile, ConfigObject[]> = {
    Test: [
        testConfig
    ],
    React: [
        reactBasicConfig,
        ...reactRecommendedConfigs,
        reactOverrideRecommendedConfig
    ]
};

/**
 * Define ESLint configuration for the AIDC Toolkit, optionally including additional profiles.
 *
 * @param esLintProfiles
 * ESLint profiles to include in the configuration.
 *
 * @returns
 * ESLint configuration for the AIDC Toolkit.
 */
export function esLintDefineAIDCToolkitConfig(...esLintProfiles: ESLintProfile[]): ConfigObject[] {
    const configs: ConfigObject[] = [
        ignoreDistConfig,
        basicConfig,
        ...recommendedConfigs,
        overrideRecommendedConfig,
        testConfig,
        reactBasicConfig,
        ...reactRecommendedConfigs,
        reactOverrideRecommendedConfig
    ];

    for (const esLintProfile of esLintProfiles) {
        configs.push(...esLintProfileConfigs[esLintProfile]);
    }

    return defineConfig(configs);
}
