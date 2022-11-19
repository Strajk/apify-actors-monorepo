const path = require(`path`)
const requirePackageName = require(`require-package-name`)

// BEWARE: This will break when npm linking packages to local ones
module.exports = function deps (obj, cwd = process.cwd()) {
  const npmDeps = new Set()
  const localDeps = new Set()

  function walk (obj) {
    Object.entries(obj).forEach(([filePath, deps]) => {
      const relPath = path.relative(cwd, filePath)
      // e.g. node_modules/apify/build/index.js
      // e.g. actors/_utils/stats.js

      if (relPath.includes(`node_modules/`)) {
        const filePathWithoutNodeModules = filePath.split(`node_modules/`)[1]
        const packageName = requirePackageName(filePathWithoutNodeModules)
        npmDeps.add(packageName)
      } else {
        localDeps.add(relPath)
        walk(deps)
      }
    })
  }

  walk(obj)

  return {
    npmDeps: [...npmDeps],
    localDeps: [...localDeps],
  }
}
