// Flat ESLint config. Two very different JS worlds live here:
//  - src/*.js      → Apps Script V8: one shared global scope, no modules, GAS services
//  - tools/*.mjs   → Node ESM scripts
// Linting goal is syntax + obvious-mistake safety, not style enforcement.
export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        // GAS services used by this project
        SpreadsheetApp: 'readonly',
        PropertiesService: 'readonly',
        LockService: 'readonly',
        HtmlService: 'readonly',
        ScriptApp: 'readonly',
        DriveApp: 'readonly',
        GmailApp: 'readonly',
        MailApp: 'readonly',
        UrlFetchApp: 'readonly',
        Utilities: 'readonly',
        Session: 'readonly',
        Logger: 'readonly',
        MimeType: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      // Cross-file references are invisible per-file (GAS merges all files into
      // one global scope), so no-undef/no-unused-vars would drown in noise.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      eqeqeq: ['warn', 'smart'],
    },
  },
  {
    files: ['tools/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
    rules: {
      'no-unused-vars': 'warn',
    },
  },
];
