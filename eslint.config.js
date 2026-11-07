import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', 'scripts/**', 'eslint.config.js'],
  },
  // 注意顺序：typescript-eslint 的 recommended 无 files 限制，
  // 必须放在 vue 配置之前，否则会覆盖 .vue 的 vue-eslint-parser
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      // 模板排版交给 Prettier（vue/html-indent / closing-bracket-newline 与其冲突）
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
