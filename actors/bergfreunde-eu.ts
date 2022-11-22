/**
 * @title: Bergfreunde (bergfreunde.eu) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details. Uses Crawlee (Apify v3).
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * @actor.base: hlidac-shopu
 * */

/*
* Issues:
* Sometimes getting `RequestError: Invalid 'connection' header: close`
* 2022-10-06 Started getting 403 after a while
* */

import { URL } from "node:url"
import { CheerioCrawler, createCheerioRouter } from "crawlee"
import { Actor } from "apify3"
import { init, save, toNumberOrNull } from "./_utils/common.js"

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
  pid: string, // e.g. 16678
  name: string, // e.g.
  url: string, // e.g.
  img: string, // e.g.
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 19.95
  originalPrice: number, // e.g. 39.95
  currency: string, // e.g. EUR
}

async function enqueueInitial (mode, crawler) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABELS.INDEX },
      url: `https://www.bergfreunde.eu/brands/`,
    }])
  } else if (mode === MODE.TEST) {
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `https://www.bergfreunde.eu/brands/poc/`,
    }])
  }
}

const router = createCheerioRouter()

router.addHandler(LABELS.INDEX, async ({ $, crawler }) => {
  const requests = []
  $(`.manufacturerlist .manufacturer-listitem .manufacturer a`).each((i, el) => {
    const url = $(el).attr(`href`) // urls are absolute
    const name = $(el).text()
    requests.push({
      userData: { label: LABELS.PRODUCTS, category: name },
      url,
    })
  })
  await crawler.addRequests(requests)
})

router.addHandler(LABELS.PRODUCTS, async ({ request, $, crawler }) => {
  console.log(`handleCategory`, request.url)
  const url = new URL(request.url)
  const path = url.pathname.split(`/`) // ['', 'brands', 'poc', '2', '']
  const maybePage = path[3]
  if (!maybePage) { // on first page
    const totalPages = Number($(`.paging .center-position .locator-item:last`).text()) // e.g. `6`
    for (let i = 2; i <= totalPages; i++) { // skip first page, that is already handled
      path[3] = i.toString()
      const newUrl = `https://www.bergfreunde.eu${path.join(`/`)}`
      void crawler.addRequests([{
        userData: { label: LABELS.PRODUCTS },
        url: newUrl,
      }])
    }
  }

  const products = []
  $(`#product-list li.product-item`).each((i, el) => {
    const pid = $(el).attr(`data-artnum`) // e.g. 418-0700
    const url = $(el).find(`a.product-link`).attr(`href`) // absolute url
    const title = $(el).find(`.manufacturer-title`).text() + // brand
        ` ` +
        $(el).find(`.product-title`).text().replace(/\n/g, ` `).trim() // title itself
    const priceRaw = $(el).find(`[data-codecept="currentPrice"]`).text().trim() // e.g. `€19.95`
    const price = priceRaw.replace(/[^\d,]/g, ``).replace(`,`, `.`) // comma decimal separator
    const priceOrigRaw = $(el).find(`[data-codecept="strokePrice"]`).text().trim() // e.g. `€19.95`
    const priceOrig = priceOrigRaw.replace(/[^\d,]/g, ``).replace(`,`, `.`) // comma decimal separator
    const img = $(el).find(`.product-image`).attr(`src`)
    const inStock = true

    const product: Output = {
      pid,
      name: title,
      url,
      img: img,
      inStock,
      currentPrice: toNumberOrNull(price),
      originalPrice: toNumberOrNull(priceOrig),
      currency: `EUR`,
    }
    products.push(product)
  })
  await save(products)
})

void Actor.main(async () => {
  const input = await Actor.getInput() as Input
  const {
    mode = MODE.FULL,
    ...rest
  } = input ?? {}
  await init({ actorNameOverride: `bergfreunde-eu` }, rest)
  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
