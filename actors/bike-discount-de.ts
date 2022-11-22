/**
 * @title: Bike Discount (bike-discount.de) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details.
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * @actor.base: hlidac-shopu
 * */

import { URL } from "node:url"
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
  debug: boolean,
};

type Output = {
  pid: string, // e.g. 16678
  name: string, // e.g. POC Essential Road Bib Shorts
  url: string, // e.g. https://www.bike-discount.de/en/poc/essential-road-bib-shorts
  img: string, // e.g. htpps://www.bike-discount.de/media/catalog/product/cache/1/image/9df78eab33525d08d6e5fb8d27136e95/p/o/poc_essential_road_bib_shorts_1.jpg
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 19.95
  originalPrice: number, // e.g. 39.95
  currency: string, // e.g. EUR
}

async function enqueueInitial (mode, crawler) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABELS.INDEX },
      url: `https://www.bike-discount.de/en/brands`,
    }])
  } else if (mode === MODE.TEST) {
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `https://www.bike-discount.de/en/brand/poc/`,
    }])
  }
}

const router = createCheerioRouter()

router.addHandler(LABELS.INDEX, async ({ crawler, $ }) => {
  const requests = []
  $(`.comer-product--info a.comer-supplier-detail`).each((i, el) => {
    const url = $(el).attr(`href`) // urls are absolute
    const name = $(el).text().trim() // there's extra space at the beginning and the end
    requests.push({
      userData: { label: LABELS.PRODUCTS, category: name },
      url,
    })
  })
  void crawler.addRequests(requests)
})

router.addHandler(LABELS.PRODUCTS, async ({ crawler, $, request, log }) => {
  log.info(`handleCategory ${request.url}`)
  if (!request.url.includes(`?p=`)) { // on first page
    const totalPages = Number($(`.listing--bottom-paging .paging--link[title="Last page"]`).text()) // e.g. `6`
    for (let i = 2; i <= totalPages; i++) { // skip first page, that is already handled
      const url = new URL(request.url)
      url.searchParams.set(`p`, i.toString()) // toString() to make TS happy
      void crawler.addRequests([{
        userData: { label: LABELS.PRODUCTS },
        url: url.toString(),
      }])
    }
  }

  const products = []
  $(`.listing--container .product--box`).each((i, el) => {
    const id = $(el).attr(`data-ordernumber`) // e.g. 20080005-40200770
    const url = $(el).find(`a.product--title`).attr(`href`) // absolute url
    const title = $(el).find(`a.product--title strong`).text() + // brand
        ` ` +
        $(el).find(`a.product--title`).attr(`title`) // title itself
    const priceRaw = $(el).find(`.product--price .is--discount, .product--price .price--default`).text().trim() // e.g. `€19.95`
    const price = priceRaw.replace(/[^\d.]/g, ``) // keep dot as it's decimal separator
    const priceOrigRaw = $(el).find(`.product--price .price--discount`).text().trim() // `€39.95`
    const priceOrig = priceOrigRaw.replace(/[^\d.]/g, ``)
    const img = $(el).find(`.image--media img`).attr(`srcset`)?.split(`,`)?.[0]
    const inStock = true
    const product: Output = {
      pid: id,
      name: title,
      url: url,
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
  await init({ actorNameOverride: `bike-discount-de` }, rest)
  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
