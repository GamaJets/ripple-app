// ESLint for the app tree (app/ and src/). Deliberately narrow.
//
// Correctness is already held by tsc (`typecheck`) and by the ~70 source gates
// in `check:all`; this config does not restate any of them. What it adds is the
// one class neither covers: React's rules of hooks. A hook called conditionally
// or after an early return compiles and passes every gate, then crashes with
// "Rendered fewer hooks than expected" on the one path that skips it —
// REDESIGN-HANDOFF §4 records exactly that defect in the coach layout.
//
//   rules-of-hooks       error — CI fails on it.
//   exhaustive-deps      warn  — reported, never fails CI. The codebase carries
//                        61 deliberate `eslint-disable … exhaustive-deps` lines,
//                        each with a reason; this keeps those meaningful.
//
// The @typescript-eslint plugin is loaded (with no rules switched on) so the 19
// existing `eslint-disable … @typescript-eslint/no-var-requires` comments name a
// rule ESLint knows, rather than erroring as unknown.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', '.tmp/**', '.preflight-export/**', 'studio-web/**', 'web/**', 'supabase/**', 'scripts/**', 'modules/**', 'targets/**', 'plugins/**'] },
  {
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
