import js from "@eslint/js";
import type { ConfigWithExtends } from "typescript-eslint";

export const esLintConfigAIDCToolkit: ConfigWithExtends[] = [
    {
        ignores: ["eslint.config.js", "dist"]
    },
    js.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: true
            }
        },

        linterOptions: {
            reportUnusedDisableDirectives: "error"
        },

        rules: {
            "no-dupe-class-members": "off",
            "no-redeclare": "off",
            "no-unused-vars": "off",

            "@typescript-eslint/class-literal-property-style": "off",
            "@typescript-eslint/class-methods-use-this": "off",
            "@typescript-eslint/init-declarations": "off",
            "@typescript-eslint/max-params": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/no-magic-numbers": "off",
            "@typescript-eslint/no-unnecessary-type-parameters": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_"
                }
            ],
            "@typescript-eslint/prefer-destructuring": "off",
            "@typescript-eslint/unbound-method": ["error", {
                ignoreStatic: true
            }],

            "@stylistic/array-bracket-newline": ["error", "consistent"],
            "@stylistic/brace-style": ["error", "1tbs", {
                allowSingleLine: false
            }],
            "@stylistic/comma-dangle": ["error", "never"],
            "@stylistic/indent": ["error", 4],
            "@stylistic/member-delimiter-style": ["error", {
                multiline: {
                    delimiter: "semi",
                    requireLast: true
                },
                singleline: {
                    delimiter: "semi"
                }
            }],
            "@stylistic/no-trailing-spaces": ["warn"],
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

            "jsdoc/require-description": ["warn", {
                contexts: ["ClassDeclaration", "ClassProperty", "FunctionDeclaration", "MethodDefinition", "TSEnumDeclaration", "TSInterfaceDeclaration", "TSModuleDeclaration", "TSTypeAliasDeclaration"]
            }],
            "jsdoc/require-jsdoc": ["warn", {
                contexts: ["ClassDeclaration", "ClassProperty", "FunctionDeclaration", "MethodDefinition", "TSEnumDeclaration", "TSInterfaceDeclaration", "TSModuleDeclaration", "TSTypeAliasDeclaration"]
            }],
            "jsdoc/require-returns": ["warn", {
                checkGetters: false
            }],
            "jsdoc/tag-lines": ["warn", "any", {
                count: 1,
                startLines: 1
            }]
        }
    }
];
