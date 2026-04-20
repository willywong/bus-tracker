const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// NodeNext-style relative imports in packages/shared end with `.js` even though
// the source files are `.ts`. Teach Metro to retry those as `.ts`/`.tsx` before
// giving up.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    (moduleName.startsWith("./") || moduleName.startsWith("../")) &&
    moduleName.endsWith(".js")
  ) {
    const base = moduleName.slice(0, -3);
    for (const ext of [".ts", ".tsx"]) {
      try {
        return context.resolveRequest(context, base + ext, platform);
      } catch {
        // try next extension
      }
    }
  }
  return (originalResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform,
  );
};

module.exports = withNativeWind(config, { input: "./global.css" });
