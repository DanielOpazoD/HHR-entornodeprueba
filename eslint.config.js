import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import react from 'eslint-plugin-react';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist', 'node_modules', '*.config.ts', 'dev-dist', 'coverage'] },
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                ...globals.browser,
                ...globals.node,
                ...globals.es2021,
            },
            parserOptions: {
                ecmaFeatures: { jsx: true },
                sourceType: 'module',
            },
        },
        plugins: {
            'react-hooks': reactHooks,
            react,
        },
        settings: {
            react: { version: 'detect' }
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            ...react.configs.recommended.rules,
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react/no-unescaped-entities': 'warn',
            'react/display-name': 'warn',
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_'
                }
            ],
            'react-hooks/rules-of-hooks': 'warn',
            'react-hooks/exhaustive-deps': 'warn',
            'react-hooks/set-state-in-effect': 'warn',
            'react-hooks/set-state-in-render': 'warn',
            'react-hooks/incompatible-library': 'warn',
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'no-useless-escape': 'warn',
            'no-useless-catch': 'warn',
            'no-control-regex': 'off',
            'no-empty': 'warn',
            '@typescript-eslint/no-require-imports': 'warn',
            '@typescript-eslint/no-empty-object-type': 'warn',
            '@typescript-eslint/ban-ts-comment': 'warn'
        },
    }
);
