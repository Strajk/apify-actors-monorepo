/**
 * @title: Bike Components (bike-components.de) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details. Uses Crawlee (Apify v3).
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * @actor.base: hlidac-shopu
 * */

import { Actor } from "apify3"
import { CheerioCrawler, createCheerioRouter } from "crawlee"
import { init, parsePrice, save } from "./_utils/common.js"

const LABELS = {
  INDEX: `INDEX`,
  PRODUCTS: `PRODUCTS`,
}

enum MODE {
  TEST = `TEST`,
  FULL = `FULL`,
}

type Input = {
  mode: MODE,
};

type Output = {
  pid: string, // e.g. 83655
  name: string, // e.g. Troy Lee Designs Drift Shorts
  url: string, // e.g. https://www.bike-components.de/en/Troy-Lee-Designs/Drift-Shorts-p83655/?v=122865-carbon
  img: string, // e.g. https://www.bike-components.de/assets/p/i/320x240/400190.jpg
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 29.95
  originalPrice: number, // e.g. 39.95
  currency: string, // e.g. EUR
}

const BASE_URL = `https://www.bike-components.de`

async function enqueueInitial (mode, crawler) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABELS.INDEX },
      url: `https://www.bike-components.de/en/brands/`,
    }])
  } else if (mode === MODE.TEST) {
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `https://www.bike-components.de/en/100-/`,
    }])
  }
}

const router = createCheerioRouter()

router.addHandler(LABELS.INDEX, async ({ enqueueLinks }) => {
  await enqueueLinks({
    selector: `.container-manufacturer-list-for-letter .site-link`,
    userData: { label: LABELS.PRODUCTS },
  })
})

router.addHandler(LABELS.PRODUCTS, async ({ crawler, $, request, log }) => {
  // Get brand id from HTML, it's needed for the API
  const brandId = $(`body`).text().match(/"manufacturerId":(\d+)}/)[1] // https://share.cleanshot.com/3YvVXs
  log.info(`[PRODUCTS] ${request.url}, brandId: ${brandId}`)

  // Paginate products via API
  let hasMorePages = true
  let page = 0
  while (hasMorePages) {
    const res = await fetch(`https://www.bike-components.de/en/api/v1/catalog/DE/property/?m%5B0%5D=${brandId}&page=${page}&productsPerPage=72`, {
      headers: {
        accept: `application/json`, // maybe not needed
        'cache-control': `no-cache`, // maybe not needed
      },
    })

    if (!res.ok) throw new Error(`[PRODUCTS] ${request.url}: API returned ${res.status} ${res.statusText}`)

    const resJson = await res.json()

    log.info(`[PRODUCTS] ${request.url}: page: ${page}, products: ${resJson.initialData.products.length}`)

    // Parsing!
    const products = []
    for (const el of resJson.initialData.products) {
      const currentPriceRaw = el.data.price // `124.99€` or ` <span>from</span>  120.99€`
      const originalPriceRaw = el.data.strikeThroughPrice // `118.99€`
      const product: Output = {
        pid: el.data.productId.toString(),
        name: el.data.name,
        url: BASE_URL + el.data.link,
        img: BASE_URL + el.data.imageMedium.path, // jpeg
        inStock: el.data.stockQuantity > 0,
        currentPrice: parsePrice(currentPriceRaw)?.amount || null,
        originalPrice: parsePrice(originalPriceRaw)?.amount || null,
        currency: `EUR`,
      }
      products.push(product)
    }
    await save(products)

    // Pagination logic
    if (resJson.initialData.paging.last > resJson.initialData.paging.current) {
      page++
    } else {
      hasMorePages = false
    }
  }
})

void Actor.main(async () => {
  const input = await Actor.getInput() as Input
  const {
    mode = MODE.FULL,
    ...rest
  } = input ?? {}
  await init({ actorNameOverride: `bike-components-de` }, rest)
  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
