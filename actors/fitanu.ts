/**
 * @title: Fitanu (fitanu.com) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details. Uses Crawlee (Apify v3).
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * @actor.base: hlidac-shopu
 * */

import { Actor } from "apify3"
import { CheerioCrawler, createCheerioRouter } from "crawlee"
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

const BASE_URL = `https://fitanu.com`

async function enqueueInitial (mode, crawler) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABELS.INDEX },
      url: `https://fitanu.com/cz/nase-znacky`,
    }])
  } else if (mode === MODE.TEST) {
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `https://fitanu.com/cz/produkty/zna%C4%8Dka/nike`,
    }])
  }
}

const router = createCheerioRouter()

router.addHandler(LABELS.INDEX, async ({ enqueueLinks }) => {
  await enqueueLinks({
    selector: `[href^="${BASE_URL}/cz/produkty/značka/"]`,
    userData: { label: LABELS.PRODUCTS },
  })
})

router.addHandler(LABELS.PRODUCTS, async ({ crawler, $, request, log }) => {
  log.info(`[PRODUCTS] ${request.url}`)
  if (!request.url.match(/\/page\/\d+$/)) { // on first page, handle navigation
    const totalPages = Number($(`.pages-items .page.last`).first().text()) // e.g. 6
    for (let i = 2; i <= totalPages; i++) { // skip first page, that is already handled
      void crawler.addRequests([{
        userData: { label: LABELS.PRODUCTS },
        url: `${request.url}/page/${i}`,
      }])
    }
  }

  const products = []
  // Some .product-item are .category-description, not real products,
  // that's why we need to filter just ones with data-product-sku
  $(`.products-grid .product-item[data-product-sku]`).each((i, el) => {
    const pid = $(el).attr(`data-product-sku`) // e.g. C92800472927
    const url = $(el).find(`a.product-item-photo`).attr(`href`) // absolute url
    const img = $(el).find(`img.product-image-photo`).attr(`src`) // absolute url
    const name = $(el).find(`.product-item-name`).text()
      .replace(/\n/g, ` `) // replace new lines with space
      .replace(/\s+/g, ` `) // replace multiple spaces with single space
    const price = $(el).find(`[data-price-type="finalPrice"]`).attr(`data-price-amount`) // e.g. 1099
    const priceOrig = $(el).find(`[data-price-type="oldPrice"]`).attr(`data-price-amount`) // e.g. 1299
    const inStock = undefined // not available
    const product: Output = {
      pid,
      name,
      url,
      img,
      inStock,
      currentPrice: toNumberOrNull(price),
      originalPrice: toNumberOrNull(priceOrig),
      currency: `CZK`,
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
  await init({ actorNameOverride: `fitanu` }, rest)
  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
