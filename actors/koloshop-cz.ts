/**
 * @title: Koloshop (koloshop.cz) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details.
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * @actor.base: hlidac-shopu
 * */

import { Actor } from "apify3"
import { BasicCrawler, createBasicRouter } from "crawlee"
import cheerio from "cheerio"
import { gotScraping } from "got-scraping"
import { init, save } from "./_utils/common.js"

enum LABEL {
  INDEX = `INDEX`,
  PRODUCTS = `PRODUCTS`,
}

enum MODE {
  TEST = `TEST`,
  FULL = `FULL`,
}

type Input = {
  mode: MODE,
};

type Output = {
  pid: string, // e.g. 3HM122CE00MRO1
  name: string, // e.g. MET Vinci MIPS silniční přilba
  url: string, // e.g. https://www.koloshop.cz/prilby-silnicni-mtb-enduro-361/MET-Vinci-MIPS-silnicni-prilba-cervena-metalicka-leskla.html
  img: string, // e.g. https://cdn.koloshop.cz/images/galerie_300/3HM122CE00MRO1.jpg
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 2399
  originalPrice: number, // e.g. 2890
  currency: string, // e.g. CZK
}

async function enqueueInitial (type, crawler) {
  if (type === MODE.FULL) {
    await crawler.addRequests([{
      url: `https://fake.xyz`,
      uniqueKey: `index`,
      userData: { label: LABEL.INDEX },
    }])
  } else if (type === MODE.TEST) {
    for (const brand of [`bikeworkx`, `crankbrothers`]) {
      await crawler.addRequests([{
        url: `https://fake.xyz`,
        uniqueKey: `brand:${brand}`,
        userData: { label: LABEL.PRODUCTS, brand },
      }])
    }
  }
}

const router = createBasicRouter()

router.addHandler(LABEL.INDEX, async ({ crawler }) => {
  const response: any = await gotScraping({
    url: `https://www.koloshop.cz/znacky/`,
  })
  const $ = cheerio.load(response.body)
  const requests = []
  $(`#brands .brand a`).each((i, el) => {
    const slug = $(el).attr(`href`).replace(/\/$/, ``) // replace trailing slash
    requests.push({
      url: `https://fake.xyz`,
      uniqueKey: `brand:${slug}`,
      userData: { label: LABEL.PRODUCTS, brand: slug },
    })
  })
  await crawler.addRequests(requests)
})

router.addHandler(LABEL.PRODUCTS, async ({ request, crawler }) => {
  const { userData } = request

  const response: any = await gotScraping({
    url: `https://www.koloshop.cz/ajax/parametryNew.php`,
    method: `POST`,
    body: new URLSearchParams({
      page_url: userData.brand,
      "params_data[stranka][]": `all`, // all pages at once, no pagination needed
      "params_data[paging]": `normal`, // not sure what this does
    }).toString(),
    headers: {
      accept: `*/*`,
      "accept-language": `en-US,en;q=0.9,cs;q=0.8,sk;q=0.7`,
      "content-type": `application/x-www-form-urlencoded; charset=UTF-8`,
    },
  }).json()

  const $ = cheerio.load(response?.snippets?.productsList)

  const products = []
  const $products = $(`.thumb.relative a`)
  $products.each((i, el) => {
    const pid = $(el).find(`.product-id`).text().trim()
    const relUrl = $(el).attr(`href`)
    const url = `https://www.koloshop.cz/${relUrl}`
    const title = $(el).find(`.product-name`).text().trim()

    const priceRaw = $(el).find(`.price-info .price, .price-info .price-new`).text().trim() // `640 Kč`
    const price = priceRaw.replace(/\D/g, ``)

    const priceOrigRaw = $(el).find(`.price-info .price-previous`).text().trim()
    const priceOrig = priceOrigRaw.replace(/\D/g, ``)
    const img = $(el).find(`img`).attr(`data-src`)

    const inStock = $(el).find(`.labels .in-stock`).length > 0

    const product: Output = {
      pid,
      name: title,
      url: url,
      img: img,
      inStock,
      currentPrice: Number(price),
      originalPrice: priceOrig ? Number(priceOrig) : null, // TODO: Unify
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
  await init({ actorNameOverride: `koloshop-cz` }, rest)
  const crawler = new BasicCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
