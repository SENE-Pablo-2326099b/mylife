// Learn more: https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The Anthropic SDK's ESM build has circular imports that Metro's transform turns into
// "Cannot access X before initialization". Its CommonJS build (same API) loads fine.
const anthropicSdk = require.resolve('@anthropic-ai/sdk');
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@anthropic-ai/sdk') return { type: 'sourceFile', filePath: anthropicSdk };
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
