/**
 * @title: FDF Bike Shop (fdfbikeshop.cz) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details.
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
  name: string, // e.g. SHIMANO pedály PD-M520
  url: string, // e.g. https://www.fdfbikeshop.cz/naslapne/shimano-pedaly-pd-m520/
  img: string, // e.g. https://cdn.myshoptet.com/usr/www.fdfbikeshop.cz/user/shop/detail_small/16678_shimano-pedaly-pd-m520-cerne-v.jpg?622b077c
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 599
  originalPrice: number, // e.g. 799
  currency: string, // e.g. CZK
};

const baseUrl = `https://www.fdfbikeshop.cz`

async function enqueueInitial (mode, crawler) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABELS.INDEX },
      url: `${baseUrl}/sitemap.xml`,
    }])
  } else if (mode === MODE.TEST) {
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `${baseUrl}/znacka/crankbrothers/`,
    }])
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `${baseUrl}/znacka/dt-swiss/`,
    }])
    await crawler.addRequests([{
      userData: { label: LABELS.PRODUCTS },
      url: `${baseUrl}/znacka/galfer/`,
    }])
  }
}

const router = createCheerioRouter()

router.addHandler(LABELS.INDEX, async ({ $, crawler }) => {
  const urls = $(`url loc`).map((i, x) => $(x).text()).toArray()
  // https://www.fdfbikeshop.cz/znacka/100/ » brands, only type of urls we are interested in
  // https://www.fdfbikeshop.cz/nahradni-dily-loziska/
  // https://www.fdfbikeshop.cz/kazety-12sp/
  // @ts-ignore
  const brandsUrls = urls.filter(url => url?.includes(`/znacka/`))
  const requests = []
  for (const url of brandsUrls) {
    requests.push({
      userData: { label: LABELS.PRODUCTS },
      // @ts-ignore
      url,
    })
  }
  await crawler.addRequests(requests)
})

router.addHandler(LABELS.PRODUCTS, async ({ $, crawler, request }) => {
  console.log(`Processing ${request.url}`)

  // on first page » handle pagination
  if (!request.url.match(/\/strana-\d+\//)) { // /znacka/fox/strana-2/
    let totalPages
    try {
      totalPages = parseInt(
        // $('.pagination-description-pages:eq(0) strong:eq(1)').text() » this does not work
        $(`.pagination-description-pages`).eq(0).find(`strong`).eq(1).text(),
      )
    } catch (e) {
      totalPages = 1
    }
    if (totalPages > 1) {
      console.log(`> …found ${totalPages} pages, enqueuing them…`)
    }
    for (let i = 2; i <= totalPages; i++) { // skip first page, that is already handled
      void crawler.addRequests([{
        userData: { label: LABELS.PRODUCTS },
        url: `${request.url}strana-${i}/`,
      }])
    }
  }

  const products = []
  $(`#category-products-wrapper .product`).each((i, el) => {
    const id = $(el).attr(`data-micro-product-id`) // e.g. 20080005-40200770

    const relUrl = $(el).find(`a.p-name`).attr(`href`)
    const url = `${baseUrl}${relUrl}`
    const title = $(el).find(`[data-micro='name']`).text()

    const priceRaw = $(el).find(`.p-det-main-price`).text().trim() // e.g. `39 990 Kč`
    const price = priceRaw.replace(/[^\d,]/g, ``) // keep comma as it's decimal separator

    const priceOrigRaw = $(el).find(`.p-standard-price span.line`).text().trim()
    const priceOrig = priceOrigRaw.replace(/[^\d,]/g, ``)

    const img = $(el).find(`img[data-micro='image']`).attr(`src`)

    let inStock = false
    try {
      inStock = $(el).find(`.p-cat-availability`).text().includes(`Skladem`)
    } catch (err) {
      // ignore
    }

    const product: Output = {
      pid: id,
      name: title,
      url: url,
      img: img,
      inStock,
      currentPrice: toNumberOrNull(price),
      originalPrice: toNumberOrNull(priceOrig),
      currency: `CZK`,
    }
    products.push(product)
  })
  void save(products)
})

void Actor.main(async () => {
  const input = await Actor.getInput() as Input
  const {
    mode = MODE.FULL,
    ...rest
  } = input ?? {}
  await init({ actorNameOverride: `fdfbikeshop-cz` }, rest)
  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
