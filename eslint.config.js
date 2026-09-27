import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
export default tseslint.config({ignores:['dist/**','node_modules/**','.figma-app/**','public/**','artifacts/**']},{files:['**/*.cjs'],rules:{'@typescript-eslint/no-require-imports':'off'}},js.configs.recommended,...tseslint.configs.recommended,{files:['**/*.{ts,tsx,js,mjs,cjs}'],languageOptions:{globals:{...globals.browser,...globals.node}},rules:{'@typescript-eslint/no-require-imports':'off','@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}});
