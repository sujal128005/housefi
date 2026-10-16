// Expo's default Metro config, plus: ignore native build output. A Gradle build writes thousands of files under
// android/ and inside every native library in node_modules; without this, Metro's file watcher churns through them and
// the dev server (and the web preview) stalls during and after a native build.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const nativeBuildOutput = /[\\/]android[\\/](?:build|\.cxx|\.gradle|\.kotlin)[\\/]/;
const current = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(current) ? current : current ? [current] : []), nativeBuildOutput];

module.exports = config;
