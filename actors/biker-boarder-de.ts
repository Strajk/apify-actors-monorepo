/**
 * @title: BikerBoarder (biker-boarder.de) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details.
 * @apify.categories: ECOMMERCE
 * @actor.base: hlidac-shopu
 * @apify.isPublic: true
 * */

/**
 * Dev notes
 * ===
 * original price is not available in listing page,
 * so we have to calculate it from the price and discount percentage
 */

import { URL } from "node:url"
import { Actor } from "apify3"
import { CheerioCrawler, createCheerioRouter } from "crawlee"
import { init, save } from "./_utils/common.js"

const LABELS = {
  INDEX: `INDEX`,
  PRODUCTS: `PRODUCTS`,
}

enum MODE {
  TEST = `TEST`, // @title: TEST mode (scrapes only "Evoc" & "Fox" brands)
  FULL = `FULL`,
}

type Input = {
  mode: MODE,
};

type Output = {
  pid: string, // e.g. 226707
  name: string, // e.g. Evoc Line 28l, heather ruby
  url: string, // e.g. https://www.biker-boarder.de/evoc/1942902_pa.html
  img: string, // e.g.
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 115.90
  originalPrice: number, // e.g. 145.00
  currency: string, // e.g. EUR
}

const BASE_URL = `https://www.biker-boarder.de`

async function enqueueInitial (mode, crawler) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABELS.INDEX },
      url: `${BASE_URL}/brands`,
    }])
  } else if (mode === MODE.TEST) {
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `${BASE_URL}/evoc`,
    }])
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `${BASE_URL}/fox`,
    }])
  }
}

async function handleIndex ({ $, crawler }) {
  const requests = []
  $(`.brand__list a.brand`).each((i, el) => {
    const relUrl = $(el).attr(`href`) // urls are relative
    const url = `${BASE_URL}${relUrl}`
    const name = $(el).attr(`title`)
    requests.push({
      userData: { label: LABELS.PRODUCTS, category: name },
      url,
    })
  })
  await crawler.addRequests(requests)
}

async function handleProducts ({ $, request, crawler }) {
  if (!request.url.includes(`?page=`)) { // on first page
    const totalPages = $(`.productlist__head .pagination .page`).last().text() // e.g. `8`
    for (let i = 2; i <= totalPages; i++) { // skip first page, that is already handled
      const url = new URL(request.url)
      url.searchParams.set(`page`, i.toString()) // toString() to make TS happy
      void crawler.addRequests([{
        userData: { label: LABELS.PRODUCTS },
        url: url.toString(),
      }])
    }
  }

  const products = []
  $(`.articlebox__list .articlebox`).each((i, el) => {
    const id = $(el).attr(`id`).replace(`pr-`, ``) // e.g. 226707
    const relUrl = $(el).children(`a`).attr(`href`) // relative url
    const url = `${BASE_URL}${relUrl}`
    const title = $(el).find(`h4`).text().trim()
    const priceRaw = $(el).find(`.price .number`).text().trim() // e.g. `ab €28,90`
    const price = priceRaw.replace(/[^\d,]/g, ``).replace(`,`, `.`) // keep comma as it's decimal separator
    let priceOrig = price
    let discount = 0
    const discountRaw = $(el).find(`.price .discount`).text().trim() // e.g. `-42%`
    if (discountRaw) {
      discount = discountRaw.replace(/[^\d,]/g, ``) // keep comma as it's decimal separator
      priceOrig = (price / (1 - discount / 100)).toFixed(2)
    }
    const img = $(el).find(`img.defaultimg`).attr(`src`)
    const inStock = true
    const product: Output = {
      pid: id,
      name: title,
      url: url,
      img: img,
      inStock,
      currentPrice: price,
      originalPrice: priceOrig,
      currency: `EUR`,
    }
    products.push(product)
  })
  void save(products)
}

const router = createCheerioRouter()
router.addHandler(LABELS.INDEX, handleIndex)
router.addHandler(LABELS.PRODUCTS, handleProducts)

void Actor.main(async () => {
  const input = await Actor.getInput() as Input
  const {
    mode = MODE.FULL,
    ...rest
  } = input ?? {}
  await init({ actorNameOverride: `biker-boarder-de` }, rest)
  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
