import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        include: ['app/__tests__/**/*.test.{ts,tsx}', 'packages/*/__tests__/**/*.test.{ts,tsx}'],
        // The first real tests land with packages/github + forms.
        passWithNoTests: true
    },
    esbuild: {
        jsx: 'automatic',
        jsxImportSource: 'sigx'
    }
});
