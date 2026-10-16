// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'ios/*', 'tools/*'],
  },
  {
    // These rules exist for the React Compiler, which this app does not use. They flag the documented React Native
    // Animated pattern (`useRef(new Animated.Value(0)).current` read during render) and resetting state at the start of a
    // data-loading effect, both of which are correct without the compiler.
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
