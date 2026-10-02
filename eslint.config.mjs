// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        // specify files to exclude from linting here
        ignores: [
            '.dev-server/',
            '.vscode/',
            '*.test.js',
            'lib/**/*.test.js',
            'test/**/*.js',
            '*.config.mjs',
            'build',
            'dist',
            'admin/words.js',
            'admin/admin.d.ts',
            '**/adapter-config.d.ts',
        ],
    },
    {
        files: ['**/*.js'],
        rules: {
            // this is a plain JS project which is type checked via JSDoc (see tsconfig.json 'checkJs'):
            // the 'typed' mode of this rule would remove @typedef, @property and @type annotations
            'jsdoc/check-tag-names': ['error', { typed: false }],
        },
    },
];
