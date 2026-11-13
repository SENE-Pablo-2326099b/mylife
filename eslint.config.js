import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['web/dist', 'node_modules', '.vercel'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // La coquille V5 regroupe l'écran et ses petites aides dans un même fichier : pas de rechargement à chaud à préserver.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true, allowExportNames: ['AccountForms', 'RecoveryKeyPanel', 'RecoveryReminder', 'WelcomePage', 'AccountPage', 'InstallPage', 'SupportCard', 'DataPage'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
