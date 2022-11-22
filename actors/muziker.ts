/**
 * @title: Muziker (muziker.cz) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details. Uses Crawlee (Apify v3).
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * */

/* Notes
- there seems to not be any way to get list of all brands
  - no page listing all brands
  - not accessible in sitemap
- Stack
  - Rails, jQuery
- Protection
  - csrf-token, but not needed to use
*/

import { URL } from "node:url"

import { CheerioCrawler, createCheerioRouter } from "crawlee"
import { Actor } from "apify3"
import { gotScraping } from "got-scraping"
import cheerio from "cheerio"
import { save, toNumberOrNull } from "./_utils/common"

const LABELS = {
  INDEX: `INDEX`,
  PRODUCTS: `PRODUCTS`,
}

enum MODE {
  TEST = `TEST`,
  CURATED = `CURATED`,
  FULL = `FULL`, // @title: Full mode (not supported yet!)
}

type Input = {
  mode: MODE,
};

type Output = {
  pid: string, // e.g.
  name: string, // e.g.
  url: string, // e.g.
  img: string, // e.g.
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 19.95
  originalPrice: number, // e.g. 39.95
  currency: string, // e.g. CZK
}

async function enqueueInitial (mode, crawler) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABELS.INDEX },
      url: `FIXME`,
    }])
  } else if (mode === MODE.CURATED) {
    const requests = [
      `bbb`,
      `belkin`,
      `buff`,
      `cep`,
      `compressport`,
      `craft`,
      `deuter`,
      `e-thirteen`,
      `fabric`,
      `fjallraven`,
      `fox`,
      `lezyne`,
      `maxxis`,
      `meatfly`,
      `muc-off`,
      `muc-off`,
      `nike`,
      `northwave`,
      `oakley`,
      `ortlieb`,
      `osprey`,
      `poc`,
      `reflex-nutrition`,
      `rockshox`,
      `rockshox`,
      `salomon`,
      `sea-to-summit`,
      `shimano`,
      `sram`,
      `stance`,
      `tatonka`,
      `thorn-fit`,
      `thule`,
      `topeak`,
      `under-armour`,
      `xiaomi`,
      `zefal`,
    ].map(url => ({
      userData: { label: LABELS.PRODUCTS },
      url: `https://www.muziker.cz/${url}`,
    }))
    await crawler.addRequests(requests)
  } else if (mode === MODE.TEST) {
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `https://www.muziker.cz/poc`,
    }])
  }
}

const router = createCheerioRouter()

router.addHandler(LABELS.INDEX, async ({ $, crawler }) => {
  console.error(`FULL mode is not supported yet`)
  process.exit(1)
})

router.addHandler(LABELS.PRODUCTS, async ({ request, $, crawler, log }) => {
  console.log(`[router:products] ${request.url}`)
  const dataSitemapNodeIdHash = $(`body`).attr(`data-sitemap-node-id-hash`) // e.g. 3b0c018517

  let page = 1
  let lastPage = false
  while (!lastPage) {
    log.info(`[router:products] ${request.url} page: ${page}`)
    const url = new URL(`https://www.muziker.cz/filter/search/${dataSitemapNodeIdHash}`)
    url.searchParams.set(`page`, page.toString())
    url.searchParams.set(`per`, `60`)
    url.searchParams.set(`sort_by`, `discount%20desc`)
    const response = await gotScraping({
      url: url.toString(),
    })
    const { products: productsHtml, pagination } = JSON.parse(response.body)
    const $$ = cheerio.load(productsHtml)

    const products = []
    $$(`.product-tile`).each((i, el) => {
      const analyticsData = JSON.parse($$(el).attr(`data-analytics-data`))
      const pid = String(analyticsData.id) // e.g. 303736
      const relUrl = $$(el).find(`a.link-overlay`).attr(`href`) // relative
      const url = `https://www.muziker.cz${relUrl}`
      const title = $$(el).find(`h4`).attr(`title`) // e.g. POC AVIP Bib Shorts
      const priceRaw = $$(el).find(`.tile-price strong`).text().trim() // e.g. 1 999 Kč
      const price = priceRaw.replace(/\D/g, ``) // remove non-digits
      const priceOrigRaw = $$(el).find(`.tile-price .text-crossed`).text().trim() // e.g. 2 999 Kč
      const priceOrig = priceOrigRaw.replace(/\D/g, ``) // remove non-digits
      const img = $$(el).find(`.tile-img img`).attr(`src`)
      const inStock = !!$$(el).find(`.basket-store-status [title^="Na skladě"]`).length

      const product: Output = {
        pid,
        name: title,
        url,
        img: img,
        inStock,
        currentPrice: toNumberOrNull(price),
        originalPrice: toNumberOrNull(priceOrig),
        currency: `CZK`,
      }
      products.push(product)
    })
    await save(products)

    lastPage = pagination.last_page
    page += 1
  }
})

void Actor.main(async () => {
  const input = await Actor.getInput() as Input
  const {
    mode = MODE.CURATED,
  } = input ?? {}

  const crawler = new CheerioCrawler({
    requestHandler: router,
    maxConcurrency: 1, // TODO: Configurable
    maxRequestRetries: 0, // TODO: Configurable
  })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
