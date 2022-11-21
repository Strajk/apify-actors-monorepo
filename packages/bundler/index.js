/*
Beware:
- following code is very opinionated
- it's meant for personal use, it's open-sourced for educational purposes
- it's still in experimental phase, so hacky&extensible is more important than clean&readable

Notes:
- It's slower than expected, I'm probably doing something wrong
- It's not tested per se, but I'm storing the output in git so that's basically snapshot testing
*/

/* eslint-disable @typescript-eslint/no-unused-vars,no-debugger */
const path = require(`path`)
const fs = require(`fs`)
const inspector = require(`inspector`)
const isCoreModule = require(`is-core-module`)
const dependencyTree = require(`dependency-tree`)
const fastGlob = require(`fast-glob`)
const swc = require(`@swc/core`)
const { Visitor } = require(`@swc/core/Visitor.js`)
const detype = require(`detype`)
const { capitalize } = require(`lodash`)
const { toSafeName } = require(`@apify-actors-monorepo/shared/utils.cjs`)
const deps = require(`./lib/deps`)
const argv = require(`minimist`)(process.argv.slice(2))
// const { CallExpression, Expression, transformSync } = require("@swc/core");

// Handle input/args
// ===
let glob = argv.glob
if (!glob) {
  if (isInDebugMode()) {
    glob = findLastModified(`../../actors/*.ts`)
    console.log(`🧠 Started in Debug mode -> using most recently modified file: ${glob}`)
  } else {
    console.log(`🧠 Started without glob arg -> running on all files`)
    glob = `actors/*.ts`
  }
}

// Visitor is "custom SWC plugin"
class ActorVisitor extends Visitor {
  constructor (collector, rawFile) {
    super()
    this._collector = collector
    this._rawFile = rawFile // there probably is a better way, but I was unable to access comments in SWC context
  }

  visitProgram (node) {
    // TODO: Nicer parsing
    const frontmatterStart = this._rawFile.indexOf(`/**`)
    const frontmatterEnd = this._rawFile.indexOf(` * */`, frontmatterStart)
    const frontmatterRaw = this._rawFile.slice(frontmatterStart, frontmatterEnd)
    const frontmatterLines = frontmatterRaw.split(`\n`)
    // get rid of first and last line
    frontmatterLines.shift()
    frontmatterLines.pop()
    const frontmatter = frontmatterLines.reduce((acc, line, lineI) => {
      const regex = /^ \* @([\w\d.]+): (.+)$/ // ` * @actor.name: Instagram scraper`
      const match = line.match(regex)
      if (match) {
        const prop = match[1]
        let val = match[2]
        // multiline support TODO: Standardize
        if (val === `>`) {
          const multilineEnd = frontmatterLines
            .slice(lineI + 1) // start at the following line
            .findIndex(line => line.startsWith(` * @`) || line.startsWith(` * */`)) // either next property or JSDoc end
          const multilineLines = frontmatterLines.slice(lineI + 1, lineI + multilineEnd + 1)
          // ' *   '.length === 5
          const multiline = multilineLines.map(line => line.slice(5)).join(`  \n`) // double space at the end to prevent markdown merging lines
          val = multiline
        }
        // boolean conversion
        if (val === `true` || val === `false`) val = val === `true`
        acc[prop] = val
      }
      return acc
    }, {})
    // { "title": "Instagram scraper", "dockerfile": "FROM node:latest" }
    if (!frontmatter.name) frontmatter.name = toSafeName(frontmatter.title)
    if (!frontmatter.version) frontmatter.version = `0.1` // double check what is the lowest version for Apify
    if (!frontmatter.buildTag) frontmatter.buildTag = `latest` // double check what exactly is a logic behind this
    if (!frontmatter.env) frontmatter.env = null // double check parsing env if present

    // We don't have enough information to determine the template yet,
    // let's determine it by detecting the call to Apify.XXXCrawler and possible override it then
    // On a second though, that:
    // ExpressionStatement > NewExpression > PropertyAccessExpression > Identifier with expression = Apify & name.endsWith Crawler might be overkill
    // let's just regex the whole file content for now
    const det = determineActorMetas(this._rawFile, frontmatter.dockerfileTemplate)
    if (!frontmatter.dockerfile) frontmatter.dockerfile = det.dockerfile // double check parsing template if present
    if (!frontmatter.defaultRunOptions) frontmatter.defaultRunOptions = det.defaultRunOptions // double check parsing template if present
    if (!frontmatter.crawlerName) frontmatter.crawlerName = det.crawlerName // double check parsing template if present

    // Shove it to the collector
    Object.assign(this._collector, frontmatter) // TODO: Maybe assign to collector.frontmatter
    // console.log(`[ActorVisitor] frontmatter`, JSON.stringify(frontmatter, null, 2))
    return super.visitProgram(node)
  }

  // Dependencies are handled elsewhere, not in AST
  // visitImportDeclaration (node) {
  // const name = node.source.value
  // const isRelative = name.startsWith(".")
  // const isNodeInternalFancy = name.startsWith("node:")
  // const isNodeInternalClassic = isCoreModule(name)
  // if (isNodeInternalFancy || isNodeInternalClassic) {
  //   if (isNodeInternalClassic && !isNodeInternalFancy) {
  //     console.log(`[visitImportDeclaration] "${name}": Prefer import … from "node:…" syntax for importing node internal/core modules`)
  //   }
  //   /* nothing */
  // } else if (isRelative) {
  //
  // } else { // -> is absolute
  //   this._collector.deps.push(name)
  // }
  //
  // return super.visitImportDeclaration(node)
  // }

  visitIdentifier (node) {
    return node
  }

  visitVariableDeclaration (node) {
    const id = node.declarations[`0`].id
    const type = id.type // Identifier
    const name = id.value // LABELS, Input, ...

    // TODO

    return super.visitVariableDeclaration(node)
  }

  visitTsEnumDeclaration (node) {
    const id = node.id.value // MODE, LABEL, ...
    const memberTypes = node.members.map(member => member.init.type) // "StringLiteral"
    // if not all member types == StringLiteral
    if (!memberTypes.every(type => type === `StringLiteral` || type === `TemplateLiteral`)) {
      console.log(`[ActorVisitor] tsEnumDeclaration: ${id} has non-string member types`)
      return
    }
    const members = node.members.map(x => {
      const value =
          x.init.value ??
          x.init.quasis[`0`].cooked
      const { title } = extractSmartComments(this._rawFile, x.span.end)
      return { value, title }
    },
    ) // [ { value: "FULL", value: "TEST", value: "SINGLE" } ]
    this._collector[id] = members // Better ENUM
    return super.visitTsEnumDeclaration(node)
  }

  // type Input = {
  //   mode: MODE,
  //   debug: boolean,
  visitTsTypeAliasDeclaration (node) {
    const name = node.id.value // *Input*, *Output*, Category, ...
    if ([`Input`, `Output`].includes(name)) { // special treatment, inspect and "collect" definition
      const def = node.typeAnnotation.members.reduce((acc, curMember) => {
        const key = curMember.key
        const typeAnnotation = curMember.typeAnnotation.typeAnnotation

        // TsTypeReference for MODE,
        const type = typeAnnotation.type
        const keyVal = key.value // mode, debug, ...
        // if (keyVal === `mode`) debugger
        const optional = // true, false, ...
          curMember.optional || // to be honest not sure which one to use
          key.optional // to be honest not sure which one to use

        let kindNative = typeAnnotation.kind // string, number, ...

        // Extract comment
        let { example } = extractSmartComments(
          this._rawFile,
          typeAnnotation.span.end, // e.g. 555
        )

        if (example) example = coerceStringToValue(example)

        // TODO: Nicer
        if (!kindNative) {
          if (type === `TsArrayType`) {
            kindNative = `TsArrayType` // we can handle 'TsArrayType' in tsTypeToJsonSchema
          } else if (type === `TsTupleType`) {
            kindNative = `array`
          } else if (type === `TsUnionType` && typeAnnotation.types.every(x => x.type === `TsLiteralType`)) { // e.g. mode: `TEST` | `LIVE`,
            // TODO: List options in input schema
            kindNative = `string`
          } else {
            const ref = typeAnnotation.typeName.value // "MODE"
            if (ref) kindNative = this._collector[ref] // ["a", "b", "c"]
          }
        }
        acc[keyVal] = {
          kind: kindNative,
          optional,
          example, //
        }
        return acc
      }, {}) // {"mode":{"kind":"string","optional":false},"debug":{"kind":"boolean","optional":false}}
      this._collector[name] = def
      // console.log(`[ActorVisitor] Type alias "${name}"`)
    }
    return super.visitTsTypeAliasDeclaration(node)
  }

  // To avoid "Uncaught Error: Method visitTsType not implemented."
  visitTsType (node) {
    return node
  }

  // visitCallExpression(expression: CallExpression): Expression {
  //   if (expression.callee.type !== "MemberExpression") {
  //     return expression;
  //   }
  //
  //   if (
  //     expression.callee.object.type === "Identifier" &&
  //     expression.callee.object.value === "console"
  //   ) {
  //     if (expression.callee.property.type === "Identifier") {
  //       return {
  //         type: "UnaryExpression",
  //         span: expression.span,
  //         operator: "void",
  //         argument: {
  //           type: "NumericLiteral",
  //           span: expression.span,
  //           value: 0,
  //         },
  //       };
  //     }
  //   }
  //   return expression;
  // }
}

// Main logic
// ===
;(async () => { // TODO: Top-level await
  const filePaths = fastGlob.sync(glob, { cwd: process.cwd() }) // TODO: What is default cwd?
  for (const filePath of filePaths) {
    const filePathNoExtension = filePath.replace(/\.\w+$/, ``)
    const fileBasenameNoExtension = path.basename(filePath).replace(/\.\w+$/, ``)
    console.log(`[Bundler] Processing "${fileBasenameNoExtension}"`)

    const distDir = path.resolve(
      path.dirname(filePath) + `-dist`, // `../actors-dist`
      fileBasenameNoExtension, // `foo.{js|mjs|ts}` -> `foo`
    ) // `/Users/…/actors-dist/foo`
    ensureDirSync(distDir, { purgeContent: true })

    // variable to store all the collected information
    const collector = {}

    const srcRaw = fs.readFileSync(filePath, `utf8`)

    /* Collector logic: Dependencies */
    /* === */
    const dependencyTreeArgs = {
      filename: filePath,
      directory: path.dirname(filePath),
      tsConfig: path.resolve(process.cwd(), `tsconfig.json`), // optional
      nodeModulesConfig: { entry: `module` },
      // filter: path => !path.includes('node_modules'), // no node_modules -> only relative deps
      noTypeDefinitions: true,
    }
    const _dependencyTree = dependencyTree(dependencyTreeArgs)
    const filePathAbsolute = path.resolve(filePath)
    const _deps = deps(
      _dependencyTree[filePathAbsolute],
      path.resolve(__dirname, `../..`, `actors`),
    )
    collector.localDeps = _deps.localDeps
    collector.npmDeps = _deps.npmDeps

    /* Collector logic: AST */
    /* === */
    // swc.transformFileSync( // TODO
    //   `../../actors/types.d.ts`,
    //   {
    //     plugin: (m) => new ActorVisitor(collector, srcRaw).visitProgram(m),
    //     jsc: {
    //       parser: {
    //         syntax: `typescript`,
    //       },
    //     },
    //   })

    // TODO: I'm unable to make swc runs independent for each file
    // when I access span (~ loc) in AST, it's affected by previously compiled files :/
    // for now, solving by running the script for each file separately from the "outside"
    swc.transformFileSync(
      filePath,
      {
        plugin: (m) => new ActorVisitor(collector, srcRaw).visitProgram(m),
        jsc: {
          target: `es2022`, // TODO: Infer from tsconfig.json
          parser: {
            syntax: `typescript`, // TODO: Dynamic
            decorators: false, /// NOTE(@strajk): explain why
            dynamicImport: false, /// NOTE(@strajk): explain why
          },
        },
      })

    // 💾 package.json
    const packageJsonDependencies = collector.npmDeps.reduce((acc, cur) => {
      acc[cur] = `*`
      return acc
    }, {})
    if (packageJsonDependencies[`crawlee`]) {
      packageJsonDependencies[`crawlee`] = `*`
      packageJsonDependencies[`apify3`] = `npm:apify@^3.0.2`
      delete packageJsonDependencies[`apify`]
    } else {
      packageJsonDependencies[`apify`] = `^2.3.2` // old-school cool
    }
    if (collector[`apify.version`] === `2`) {
      packageJsonDependencies[`apify`] = `^2.3.2` // old-school cool
    }

    const packageJson = {
      name: collector.name,
      description: collector.description,
      type: `module`,
      scripts: {
        start: `node ./main.js`,
        "push-to-apify-platform": `npx apify push`,
      },
      dependencies: packageJsonDependencies,
      // My convention, not standard!
      apify: {
        title: collector.title,
        description: collector.description,

        isPublic: collector[`apify.isPublic`] ?? false,
        isDeprecated: collector[`apify.isDeprecated`] ?? false,
        // issuesEnabled: collector[`apify.issuesEnabled`] ?? true, // This option was removed from platform
        isAnonymouslyRunnable: collector[`apify.isAnonymouslyRunnable`] ?? true,
        notice: collector[`apify.notice`] ?? ``,

        pictureUrl: ``,
        seoTitle: collector[`apify.seoTitle`] ?? ``,
        seoDescription: collector[`apify.seoDescription`] ?? ``,
        // TODO: Validate with `const ACTOR_CATEGORIES`
        categories: collector[`apify.categories`]?.split(`,`)?.map(x => x.trim()) ?? null,
      },
    }
    fs.writeFileSync(
      path.join(distDir, `package.json`),
      JSON.stringify(packageJson, null, 2),
    )

    // 💾 Dockerfile
    const dockerfile = collector.dockerfile
    const dockerfileLines = dockerfile.split(`\n`)
    const lineWithFrom = dockerfileLines.findIndex((line) => line.startsWith(`FROM`))
    if (collector.dockerfileAfterFrom) {
      dockerfileLines.splice(lineWithFrom + 1, 0, collector.dockerfileAfterFrom)
      // TODO: Improve as needed
    }
    fs.writeFileSync(
      path.join(distDir, `Dockerfile`),
      dockerfileLines.join(`\n`),
    )

    // 💾 apify.json (Apify Actor manifest)
    const apifyJson = {
      name: collector.name,
      version: collector.version,
      buildTag: collector.buildTag,
      env: collector.env,
      defaultRunOptions: collector.defaultRunOptions,
    }
    fs.writeFileSync(
      path.resolve(distDir, `apify.json`),
      JSON.stringify(apifyJson, null, 2),
    )

    // 💾 .actor/actor.json (Apify Actor manifest)
    let actorJson = null // only populate when there's Output in collector
    if (collector.Output) {
      actorJson = {
        actorSpecification: 1,
        name: collector.name,
        title: collector.title,
        description: collector.description,
        version: collector.version + `.0`,
        storages: {
          dataset: {
            actorSpecification: 1,
            title: collector.title,
            description: collector.description,
            views: {
              overview: {
                title: `Overview`,
                description: `Overview of the most important fields`,
                transformation: {
                  fields: Object.keys(collector.Output),
                },
                display: {
                  component: `table`,
                  // TODO: Refactor yo!
                  columns: Object.entries(collector.Output).reduce((acc, [key, def]) => {
                    if (key === `itemUrl`) {
                      const idColumn = acc.find(x => x.field === `itemId`)
                      if (idColumn) {
                        idColumn.format = `link`
                        idColumn.textField = `itemId`
                        idColumn.field = `itemUrl`
                        return acc
                      }
                    }

                    acc.push({
                      label: camelCaseToWords(key),
                      field: key,
                      ...tsTypeToOutputSchema(def.kind, key),
                    })
                    return acc
                  }, []),
                },
              },
            },
          },
        },
      }
    }
    ensureDirSync(path.resolve(distDir, `.actor`))

    if (actorJson) {
      fs.writeFileSync(
        path.resolve(distDir, `.actor`, `actor.json`),
        JSON.stringify(actorJson, null, 2),
      )
    }

    // 💾 .actor/logo.png
    // if sibling file with png extension exists, use it
    const maybeImagePath = filePathNoExtension + `.png`
    if (fs.existsSync(maybeImagePath)) {
      fs.copyFileSync(path.resolve(maybeImagePath), path.resolve(distDir, `.actor`, `logo.png`))
    } else {
      console.warn(`[Bundler] actor has no image – not a problem, just letting you know`)
    }

    // 💾 README.md
    let readmeMd = stripIndent(`
      # ${collector.title}
      
      ${collector.readme ?? collector.description}  
    `)

    if (collector[`apify.proxyAllow`]) {
      readmeMd += `\n\n`
      readmeMd += stripIndent(`
        🤖🚫 **BEWARE**: Requires access to "${collector[`apify.proxyAllow`]}" proxy group. 
      `)
    }

    if (collector.Output) {
      const outputInMd = Object.entries(collector.Output).reduce((acc, [key, def]) => {
        acc += `\n`
        acc += stripIndent(`
          * **${key}** \`${def.kind}\` ${def.example ? `e.g. *${def.example}*` : ``}
        `)
        return acc
      }, ``)
      readmeMd += `\n\n`
      readmeMd += stripIndent(`
        ## Output example
        ${outputInMd}
      `)
    }
    fs.writeFileSync(
      path.resolve(distDir, `README.md`),
      readmeMd,
    )

    // 💾 INPUT_SCHEMA.json
    const inputSchemaProperties = Object.entries(collector.Input ?? {}).reduce((acc, [key, def]) => {
      acc[key] = {
        title: capitalize(key),
        description: ``,
        ...tsTypeToJsonSchema(def, key),
      }
      if (key === `debug`) {
        acc[key].description = `Debug mode prints more logs, disables concurrency and other optimizations.`
        acc[key].default = false
        // acc[key].prefill = false;
      }
      return acc
    }, {})

    inputSchemaProperties[`APIFY_USE_MEMORY_REQUEST_QUEUE`] = {
      sectionCaption: `Advanced`,
      sectionDescription: `Advanced options, use only if you know what you're doing.`,

      title: `Use in-memory request queue instead of the native one`,
      description: `In-memory request queue can reduce costs, but it may case issues with longer runs due to non-persistence.`,
      type: `boolean`,
      default: false,
      editor: `checkbox`,
    }

    // TODO: Refactor! This is very specific!
    if (collector[`actor.base`] === `hlidac-shopu`) {
      inputSchemaProperties[`APIFY_DONT_STORE_IN_DATASET`] = {
        title: `Don't store in dataset`,
        description: `If set to true, the actor will not store the results in the default dataset. Useful when using alternative storage, like own database`,
        type: `boolean`,
        default: false,
        editor: `checkbox`,
      }
      inputSchemaProperties[`PG_CONNECTION_STRING_NORMALIZED`] = {
        title: `Postgres connection string for normalized data`,
        description: `If set, actor will store normalized data in Postgres database in PG_DATA_TABLE and PG_DATA_PRICE_TABLE tables`,
        type: `string`,
        editor: `textfield`,
      }
      inputSchemaProperties[`PG_DATA_TABLE`] = {
        title: `Postgres table name for product data`,
        description: `Table name for storing product name, url, image, ...`,
        type: `string`,
        editor: `textfield`,
      }
      inputSchemaProperties[`PG_DATA_PRICE_TABLE`] = {
        title: `Postgres table name for price data`,
        description: `Table name for storing price, original price, stock status, ...`,
        type: `string`,
        editor: `textfield`,
      }
    }
    const inputSchemaRequired = Object.entries(collector.Input ?? {}).reduce((acc, [key, def]) => {
      if (
        !def.optional &&
        def.kind !== `boolean` // booleans cannot be required, otherwise false would trigger validation error WTF??
      ) acc.push(key)
      return acc
    }, [])
    const inputSchemaJson = {
      // TODO:
      // "$schema": `https://github.com/apify/apify-shared-js/blob/master/packages/input_schema/src/schema.json`,
      title: collector.title,
      description: collector.description,
      type: `object`,
      schemaVersion: 1,
      properties: inputSchemaProperties,
      required: inputSchemaRequired,
    }
    fs.writeFileSync(
      path.resolve(distDir, `INPUT_SCHEMA.json`),
      JSON.stringify(inputSchemaJson, null, 2),
    )

    // 💾 local dependencies
    // e.g. ['_utils/stats.js']
    collector.localDeps.forEach((dep) => {
      // `../../actors/_utils/common.js -> `_utils/common.js`
      // const depRelativeToActorsRoot = path.relative(`../../actors`, dep) // this suddenly stopped working :(
      const depRelativeToActorsRoot = dep.replace(`../../actors/`, ``)
      const src = path.resolve(__dirname, `../../actors`, depRelativeToActorsRoot)
      const dst = path.resolve(distDir, depRelativeToActorsRoot)
      // console.log(`Copying ${src} to ${dst}`)
      fs.cpSync(src, dst)
    })

    // 💾 main.js
    // CONSIDERING
    // A: Bundling:
    // But actually not sure if this the best way, I may like to leave the code in it's original form
    // Bundling (swcpack) - https://swc.rs/docs/usage/bundling
    // 🚧 This feature is still under construction.
    // This feature is currently named spack, but will be renamed to swcpack in v2

    // const bundle = await swc.bundle({
    //   name: 'main',
    //   entry: {
    //     simple: filePath
    //   },
    // });

    // B: Extracting dependencies to package.json, copy utils, minimaly compile TS
    const frontmatterEnd = srcRaw.indexOf(` * */`) + 5
    const mainWithoutFrontmatter = srcRaw.slice(frontmatterEnd).trim()
    const dist = await detype.transform(
      mainWithoutFrontmatter,
      filePath,
    )

    fs.writeFileSync(
      path.resolve(distDir, `main.js`),
      dist,
    )

    console.log(`[Bundler] Done "${fileBasenameNoExtension}"`)

    fs.writeFileSync(path.resolve(
      path.dirname(filePath), // `../actors`
      fileBasenameNoExtension + // `foo.{js|mjs|ts}` -> `foo`
      `.collector.json`,
    ), JSON.stringify(collector, null, 2))
  }
})()

// https://raw.githubusercontent.com/apify/apify-shared-js/master/packages/input_schema/src/schema.json
function tsTypeToJsonSchema ({ kind, example }, key) {
  if (Array.isArray(kind)) {
    // Either:
    // * [string]
    // * [{ value: string, [title]: string }]

    let _default
    let _prefill
    let _enum = [] // eslint-disable-line prefer-const
    let _enumTitles = [] // eslint-disable-line prefer-const
    kind.forEach((item, i) => {
      if (i === 0) {
        _default = item.value ?? item
        _prefill = item.value ?? item
      }
      _enum.push(item.value ?? item)
      _enumTitles.push(item.title ?? item.value ?? item)
    })

    return {
      type: `string`,
      editor: `select`,
      /*
      enum MODE {
        FULL = "Full",
        TEST = "Test",
        SINGLE = "Single"
      }
      does not work, cause MODE.FULL will be converted to "FULL"
      not sure if detype does that or who
      * */

      default: _default,
      prefill: _prefill,
      enum: _enum,
      enumTitles: _enumTitles,
    }
  }

  switch (kind) {
    case `string`:
      return {
        type: `string`,
        editor: `textfield`,
      }
    case `boolean`:
      return {
        type: `boolean`,
        editor: `checkbox`,
      }
    case `number`:
      return `number`
    case `object`:
      if (key === `proxyConfiguration`) {
        return {
          title: `Proxy configuration`,
          description: `Select proxies to be used by your actor.`,
          type: `object`,
          editor: `proxy`,
          default: { useApifyProxy: true, apifyProxyGroups: [`RESIDENTIAL`] },
          prefill: { useApifyProxy: true, apifyProxyGroups: [`RESIDENTIAL`] },
        }
      }
      return `object`
    case `array`:
      if (key === `urls`) {
        return {
          type: `array`,
          editor: `requestListSources`,
          prefill: [{ url: example }],
        }
      }
      return {
        type: `array`,
        editor: `stringList`,
      }
    case `TsArrayType`:
      return {
        type: `array`,
        editor: `stringList`,
      }

    default:
      debugger
      console.log(`Unknown kind: ${kind}`)
      // throw new Error(`Unknown type: ${kind}`)
  }
}

function tsTypeToOutputSchema (type, key) {
  // if (Array.isArray(type)) {
  //   return {
  //     type: "string",
  //     editor: "select",
  //     default: type[0].toUpperCase(),
  //     prefill: type[0].toUpperCase(), // yo wtf fixme
  //     enumTitles: type,
  //     enum: type.map(x => x.toUpperCase()),
  //   }
  // }

  switch (type) {
    case `string`:
      if (key === `img` || key === `image`) {
        return {
          format: `image`,
        }
      }
      if (key.toLowerCase().includes(`url`)) {
        return {
          format: `link`,
        }
      }
      return {
        format: `text`,
      }
    case `boolean`:
      return {
        format: `boolean`,
      }
    case `number`:
      return {
        format: `number`,
      }
    case `object`:
      return {
        format: `object`,
      }
    case `array`:
      return {
        format: `array`,
      }
    default:
      return {
        format: `text`,
      }
  }
}

function determineActorMetas (rawContent, dockerfileTemplate) {
  let docker = {
    // After FROM
    install: `DD_AGENT_MAJOR_VERSION=7 DD_API_KEY=<REPLACE> DD_SITE="datadoghq.eu" bash -c "$(curl -L https://s3.amazonaws.com/dd-agent/scripts/install_script.sh)"`,
    // After NPM I
    config: `
      COPY datadog-config.yaml .
      RUN cat datadog-config.yaml >> /etc/datadog-agent/datadog.yaml
    `,
    // After @config
    enableLogsUpload: `
      RUN mkdir -p /etc/datadog-agent/conf.d/apify.d
      COPY actor-datadog-log-conf.yaml /etc/datadog-agent/conf.d/actor.d/conf.yaml
    `,
  }

  // disable for now
  docker = {
    install: ``,
    config: ``,
    enableLogsUpload: ``,
  }

  const defaultRunOptions = {
    build: `latest`,
    timeoutSecs: 3600,
    memoryMbytes: 1024,
  }

  const match = rawContent.match(/new (Apify\.)?(\w+)Crawler\(/) // Support both v2 `new Apify.CheerioCrawler` and v3 `new CheerioCrawler`
  if (!match) {
    console.warn(`Could not determine crawler type`)
    return {
      template: `getting_started_node`, // -> low memory
      dockerfile: stripIndent(`
          FROM apify/actor-node:16
          
          COPY package.json ./
          
          RUN npm --quiet set progress=false \\
            && npm install --only=prod --no-optional \\
            && (npm list --only=prod --no-optional --all || true)
          
          COPY . ./        
        `),
    }
  }

  // override
  const crawlerName = dockerfileTemplate ?? match[2] // Basic, Cheerio, Puppeteer, Playwright
  switch (crawlerName) {
    case `Basic`:
    default:
      return {
        crawlerName: `Basic`,
        defaultRunOptions,
        // TODO: Same as Cheerio, is that correct?
        dockerfile: stripIndent(`
          FROM apify/actor-node:16
          
          COPY package.json ./
          
          RUN npm --quiet set progress=false \\
            && npm install --only=prod --no-optional
          
          COPY . ./        
        `),
      }
    case `Cheerio`:
      return {
        crawlerName: `Cheerio`,
        defaultRunOptions,
        dockerfile: stripIndent(`
          FROM apify/actor-node:16
          
          COPY package.json ./
          
          RUN npm --quiet set progress=false \\
            && npm install --only=prod --no-optional
          
          COPY . ./        
        `),
      }
    case `Puppeteer`:
      return {
        crawlerName: `Puppeteer`,
        defaultRunOptions: { ...defaultRunOptions, memoryMbytes: 4096 },
        dockerfile: stripIndent(`
          FROM apify/actor-node-puppeteer-chrome:16
          
          COPY package.json ./
          
          RUN npm --quiet set progress=false \\
            && npm install aws-crt \\
            && npm install --only=prod --no-optional
          
          COPY . ./
        `),
      }
    case `Playwright`:
      return {
        crawlerName: `Playwright`,
        defaultRunOptions: { ...defaultRunOptions, memoryMbytes: 4096 },
        // OPINION WARNING: Using Firefox!
        // TODO: Allow specifying browser
        dockerfile: stripIndent(`
          FROM apify/actor-node-playwright-firefox:16
          
          COPY package.json ./
          
          RUN npm --quiet set progress=false \\
            && npm install aws-crt \\
            && npm install --only=prod --no-optional
          
          COPY . ./
        `),
      }
  }
}

function ensureDirSync (dir, { purgeContent = false } = {}) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (purgeContent) {
    // Don't just delete the directory, cause it would confuse e.g. the terminal
    const files = fs.readdirSync(dir)
    for (const file of files) fs.rmSync(path.join(dir, file), { recursive: true })
  }
}

// TODO: Nicer
function coerceStringToValue (string) {
  if (string === `true`) return true
  if (string === `false`) return false
  if (string === `null`) return null
  if (string === `undefined`) return undefined
  if (string.match(/^\d+$/)) return parseInt(string)
  return string
}

function stripIndent (string) {
  // TODO: Template literals/fn
  // TODO: Reuse from common tags
  const trimmed = string.trim()
  const lines = trimmed.split(`\n`)
  const contentLine = lines[1] ?? lines[0]
  const indent = contentLine.match(/^\s*/)[0]
  return trimmed.replace(new RegExp(`^${indent}`, `gm`), ``)
}

// TODO: Nicer
// Item Id -> Item ID
// Item Url -> Item URL
// Img -> Image
function camelCaseToWords (camelCase) {
  const camel = camelCase.replace(/([A-Z])/g, ` $1`).trim()
  let res = camel.charAt(0).toUpperCase() + camel.slice(1)
  res = res.replace(/\bId\b/, `ID`)
  return res
}

function extractSmartComments (string, fromChar) {
  const newLineAfterMember = string.indexOf(`\n`, fromChar) // e.g. 590
  const trailingComment = string.slice(fromChar, newLineAfterMember)
  const example = trailingComment.split(`e.g.`)?.[1]?.trim()
  const title = trailingComment.split(`@title:`)?.[1]?.trim()
  return { example, title }
}

function isInDebugMode () {
  return inspector.url() !== undefined
}

function findLastModified (dir) {
  const filePaths = fastGlob.sync(dir, { cwd: process.cwd() })
  let lastModifiedTime = 0
  let lastModifiedFilePath
  filePaths.forEach((curFilePath) => {
    const mtime = fs.statSync(curFilePath).mtimeMs // mtimeMs = modified time in milliseconds
    if (mtime > lastModifiedTime) {
      lastModifiedTime = mtime
      lastModifiedFilePath = curFilePath
    }
  })
  return lastModifiedFilePath
}
