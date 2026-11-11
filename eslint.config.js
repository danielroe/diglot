import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: ['.workmux/**', 'fixtures/**', 'packages/*/test/fixtures/**'],
})
