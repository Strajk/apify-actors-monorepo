import { createHash } from 'crypto'
import os from "os"
import path from "path"
// eslint-disable-next-line @apify/apify-actor/no-forbidden-node-internals
import fs from "fs"
import pg from "pg"
import pgConnectionString from 'pg-connection-string'
import { config } from 'dotenv'
import findConfig from "find-config"
import { Client as ElasticClient } from "@elastic/elasticsearch"
import filenamify from 'filenamify'
import { Configuration, Dataset } from 'crawlee'
import { MemoryStorage } from '@crawlee/memory-storage'

config({ path: findConfig(`.env`) })

const elasticIndexName = `actors-monorepo-shops`

const globalLogsProps = {
  __NODE_STARTED: new Date().toISOString(),
}

let actorName
let pgClient
let pgClientNormalized
let elasticClient
export async function init ({ actorNameOverride }, restInput) {
  parseEnvFromInput(restInput)

  if (os.platform() === `darwin`) {
    const filePath = process.argv[1] // ~/Projects/apify-actors-monorepo/actors/foo.ts
    const basename = path.basename(filePath) // foo.ts
    actorName = actorNameOverride ?? basename.split(`.`)[0] // foo
    const gitBranch = fs.readFileSync(path.join(process.cwd(), `..`, `.git/HEAD`), `utf8`)
      .split(` `)[1]
      .trim()
      .replace(`refs/heads/`, ``)
    const gitCommit = fs.readFileSync(path.join(process.cwd(), `..`, `.git/refs/heads/${gitBranch}`), `utf8`)
    const gitCommitShort = gitCommit.substring(0, 7)
    globalLogsProps.__GIT_COMMIT = gitCommitShort
  }

  if (process.env.APIFY_USE_MEMORY_REQUEST_QUEUE === `true`) { // dotenv -> bool-like vars are strings
    Configuration.getGlobalConfig().useStorageClient(new MemoryStorage())
  }

  if (process.env.APIFY_IS_AT_HOME) {
    actorName = actorNameOverride ?? process.env.APIFY_ACTOR_ID // Name would be better, but it's not in ENV
  }

  /* ELASTIC */
  /* ======= */
  if (process.env.ELASTIC_CLOUD_ID) {
    elasticClient = new ElasticClient({
      cloud: { id: process.env.ELASTIC_CLOUD_ID },
      auth: { apiKey: process.env.ELASTIC_CLOUD_API_KEY },
    })

    // const mapping = await elasticClient.indices.getMapping({ index: actorName })

    // eslint-disable-next-line no-inner-declarations
    async function enforceIndexMapping () {
      const doesIndexExist = await elasticClient.indices.exists({ index: elasticIndexName })
      if (!doesIndexExist) await elasticClient.indices.create({ index: elasticIndexName })
      await elasticClient.indices.putMapping({
        index: elasticIndexName,
        body: {
          properties: {
            _discount: { type: `float` },
            originalPrice: { type: `float` },
            currentPrice: { type: `float` },
          },
        },
      })
    }

    try {
      await enforceIndexMapping()
    } catch (err) {
      if (err.message.includes(`cannot be changed from type`)) {
        console.log(`Elastic index ${elasticIndexName} already exists with incorrect mappings. As existing mapping cannot be changed, index will be deleted and recreated.`)
        await elasticClient.indices.delete({ index: elasticIndexName })
        await enforceIndexMapping()
      }
    }
  }

  /* POSTGRESQL */
  /* ========== */
  if (process.env.PG_CONNECTION_STRING) {
    const pgConfig = pgConnectionString(process.env.PG_CONNECTION_STRING)
    // const pgPool = new pg.Pool(pgConfig)

    pgClient = new pg.Client(pgConfig)
    await pgClient.connect()

    // Check if table exists and have proper columns
    const { rows: tables } = await pgClient.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `)

    // eslint-disable-next-line camelcase
    const tableExists = tables.some(({ table_name }) => table_name === process.env.PG_DATA_TABLE)
    if (!tableExists) {
      throw new Error(`Table ${process.env.PG_DATA_TABLE} does not exist in database ${pgConfig.database}`)
    }

  // TODO: Handle pgClient closing
  }

  if (process.env.PG_CONNECTION_STRING_NORMALIZED) {
    const pgConfig = pgConnectionString(process.env.PG_CONNECTION_STRING_NORMALIZED)

    pgClientNormalized = new pg.Client(pgConfig)
    await pgClientNormalized.connect()

    // Check if table exists and have proper columns
    const { rows: tables } = await pgClientNormalized.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `)

    // eslint-disable-next-line camelcase
    const tableMainExists = tables.some(({ table_name }) => table_name === process.env.PG_DATA_TABLE)
    // eslint-disable-next-line camelcase
    const tablePricesExists = tables.some(({ table_name }) => table_name === process.env.PG_DATA_PRICE_TABLE)
    if (!tableMainExists) throw new Error(`Table ${process.env.PG_DATA_TABLE} does not exist in database ${pgConfig.database}`)
    if (!tablePricesExists) throw new Error(`Table ${process.env.PG_DATA_PRICE_TABLE} does not exist in database ${pgConfig.database}`)

  // TODO: Handle pgClient closing
  }
}

// inspired by @drobnikj
// TODO: Similar, but less obfuscated for easier debugging
export const createUniqueKeyFromUrl = (url) => {
  const hash = createHash(`sha256`)
  const cleanUrl = url.split(`://`)[1] // Remove protocol
  hash.update(cleanUrl)
  return hash.digest(`hex`)
}

/**
 *
 * @param {Date} datetime
 * @return {Promise<void>}
 */
export const sleepUntil = async (datetime) => {
  const now = new Date()
  const difference = datetime - now
  if (difference > 0) {
    return new Promise((resolve) => {
      setTimeout(resolve, difference)
    })
  }
  return Promise.resolve()
}

// TODO: Uff, nicer! But at least it's tested
export function parsePrice (string) {
  let amount, currency
  const noText = string.replace(/[^\d,.]/g, ``)
  const decimals = noText.match(/([,.])(\d{2})$/)
  if (decimals) {
    const decimalSeparator = decimals[1] // ?
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    const decimalAmount = decimals[2] // ?
    const mainAmount = noText.split(decimalSeparator)[0].replace(/\D/g, ``)
    amount = parseFloat(mainAmount + `.` + decimalAmount) // ?
  } else {
    const justNumbers = noText.replace(/[,.]/g, ``)
    amount = parseInt(justNumbers)
  }
  return { amount, currency }
}

export function toNumberOrNull (str) {
  // TODO: Handle better, but only after adding test
  if (str === undefined) return null
  if (str === null) return null
  if (str === ``) return null
  const num = Number(str)
  if (Number.isNaN(num)) return null
  return num
}

export async function save (objs) {
  if (!Array.isArray(objs)) objs = [objs]
  if (objs.length === 0) return console.log(`No data to save.`)

  const objsExtended = await Promise.all(objs.map(async (obj) => {
    const objExtended = {
      ...obj,
      actorName,
      ...globalLogsProps,
      // __NODE_VERSION: global.process.versions.node,
      // __NODE_UPTIME: global.process.uptime().toFixed(2), // seconds, 2 decimals
    }
    // if run on Apify
    if (process.env.APIFY_IS_AT_HOME) {
      objExtended.__APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID
      objExtended.__APIFY_ACTOR_RUN_ID = process.env.APIFY_ACTOR_RUN_ID
      objExtended.__APIFY_ACTOR_BUILD_ID = process.env.APIFY_ACTOR_BUILD_ID
      objExtended.__APIFY_ACTOR_BUILD_NUMBER = process.env.APIFY_ACTOR_BUILD_NUMBER
      objExtended.__APIFY_ACTOR_TASK_ID = process.env.APIFY_ACTOR_TASK_ID
      if (process.env.APIFY_DONT_STORE_IN_DATASET !== `true`) { // Note: dotenv is not casting vars, so they are strings
        await Dataset.pushData(obj)
      }
    }
    return objExtended
  }))

  // if runs on local machine (MacOS)
  if (os.platform() === `darwin`) {
    const cwd = process.cwd() // ~/Projects/apify-actors-monorepo/actors
    const storageDir = path.join(cwd, `${actorName}.storage`) // ~/Projects/apify-actors-monorepo/actors/foo.storage
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir)
    const dataDir = path.join(storageDir, `data`) // ~/Projects/apify-actors-monorepo/actors/foo.storage/data
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir)
    for (const objExtended of objsExtended) {
      const id = String(objExtended.id ?? objExtended.pid) // ?? uuidv4()
      const fileName = `${filenamify(id)}.json`
      const dataFilePath = path.join(dataDir, fileName) // ~/Projects/apify-actors-monorepo/actors/foo.storage/data/foo.json
      fs.writeFileSync(dataFilePath, JSON.stringify(objExtended, null, 2))
    }
  }

  if (pgClient) {
    const objsPg = objs.map((obj) => ({
      ...obj,
      // TODO: This is becoming not nice, and not clear
      shop: actorName,
      scrapedAt: new Date().toISOString().split(`T`)[0],
    }))

    const columns = getColumns(objsPg)
    const values = getValues(objsPg)
    const queryString = `
        INSERT INTO public."${process.env.PG_DATA_TABLE}" (${columns})
        VALUES (${values})
    `
    try {
      const { rowCount } = await pgClient.query(queryString)
      console.log(`[save] saved to database: ${JSON.stringify(rowCount)}`)
    } catch (err) {
      if (err.message.includes(`violates unique constraint`)) console.warn(`PostgresSQL: violates unique constraint`)
      else throw err
    }
  }

  // Only make sense for HlidacShopu
  if (pgClientNormalized) {
    const objsPgData = objs.map((obj) => ({
      shop: actorName,
      pid: obj.pid,
      name: obj.name,
      url: obj.url,
      img: obj.img,
    }))

    const objsPgDataPrice = objs.map((obj) => ({
      shop: actorName,
      pid: obj.pid,
      scrapedAt: new Date().toISOString().split(`T`)[0],
      currentPrice: obj.currentPrice,
      originalPrice: obj.originalPrice,
      inStock: obj.inStock,
    }))

    const queryString = `
        INSERT INTO public."${process.env.PG_DATA_TABLE}" (${getColumns(objsPgData)})
        VALUES (${getValues(objsPgData)})
        ON CONFLICT DO NOTHING
    `
    try {
      const { rowCount } = await pgClientNormalized.query(queryString)
      console.log(`[save] saved to database (data): ${JSON.stringify(rowCount)}`)
    } catch (err) {
      if (err.message.includes(`violates unique constraint`)) console.warn(`PostgresSQL: violates unique constraint`)
      else throw err
    }

    const queryStringPrice = `
        INSERT INTO public."${process.env.PG_DATA_PRICE_TABLE}" (${getColumns(objsPgDataPrice)})
        VALUES (${getValues(objsPgDataPrice)})
        ON CONFLICT DO NOTHING
    `
    try {
      const { rowCount } = await pgClientNormalized.query(queryStringPrice)
      console.log(`[save] saved to database (price): ${JSON.stringify(rowCount)}`)
    } catch (err) {
      if (err.message.includes(`violates unique constraint`)) console.warn(`PostgresSQL: violates unique constraint`)
      else throw err
    }
  }

  if (elasticClient) {
    // .index creates or updates the document
    // .create creates a new document if it doesn't exist, 409 if it does
    // try {
    //   const res = await elasticClient.index({
    //     index: `actors-monorepo-shops`, // TODO: Consider using actorName
    //     id, // foo-bar
    //     document: objExtended, // {...}
    //   })
    // } catch (err) {
    //   // https://discuss.elastic.co/t/elasticsearch-503-ok-false-message-the-requested-deployment-is-currently-unavailable/200583
    //   if (err.message.includes(`requested resource is currently unavailable`)) console.log(`Elasticsearch is unavailable, skipping, but not aborting`)
    //   else throw err
    // }
  }
}

function getColumns (objs) {
  return Object.keys(objs[0]).map((key) => `"${key}"`).join(`, `)
}

function getValues (objs) {
  return objs.map(objPg => Object.values(objPg).map((value) => {
    // escape strings to prevent SQL injection
    if (typeof value === `string`) return `'${value.replace(/'/g, `''`)}'`
    // convert to DB specific null
    if (typeof value === `undefined` || value === null) return `NULL`
    return value
  }).join(`, `)).join(`), (`)
}

export function parseEnvFromInput (input) {
  const env = {}
  for (const key in input) {
    if (key === key.toUpperCase()) env[key] = input[key]
  }
  console.log(`[parseEnvFromInput] ${JSON.stringify(env)}`)
  Object.assign(process.env, env)
}

export const isInspect =
  process.execArgv.join().includes(`--inspect`) ||
  // @ts-ignore
  process?._preload_modules?.join(`|`)?.includes(`debug`)
