/**
 * @title: Český ráj (ceskyraj.com) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details.
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * @actor.base: hlidac-shopu
 * */

import { URL } from "url"
import { Actor } from "apify3"
import { CheerioCrawler, createCheerioRouter } from "crawlee"
import { init, save, toNumberOrNull } from "./_utils/common.js"

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
  pid: string, // e.g. p1390167
  name: string, // e.g. Pedály Crankbrothers Stamp 7 orange
  url: string, // e.g. https://www.ceskyraj.com/pedaly-crankbrothers-stamp-7-orange-p1141669/
  img: string, // e.g.
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 3896
  originalPrice: number, // e.g. 3999
  currency: string, // e.g. CZK
}

async function enqueueInitial (type, crawler) {
  if (type === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABEL.INDEX },
      url: `https://www.ceskyraj.com/nase-znacky/`,
    }])
  } else if (type === MODE.TEST) {
    const requests = [
      {
        userData: { label: LABEL.PRODUCTS },
        url: `https://www.ceskyraj.com/hydrapak/`,
      },
      {
        userData: { label: LABEL.PRODUCTS },
        url: `https://www.ceskyraj.com/crankbrothers/`,
      },
      {
        userData: { label: LABEL.PRODUCTS },
        url: `https://www.ceskyraj.com/camelbak/`,
      },
    ]
    await crawler.addRequests(requests)
  }
}

const router = createCheerioRouter()

router.addHandler(LABEL.INDEX, async ({ crawler, $ }) => {
  const requests = []
  $(`#SubCategories ul.root li.leaf a.name`).each((i, el) => {
    const url = $(el).attr(`href`)
    const name = $(el).text()
    requests.push({
      url: `https://www.ceskyraj.com` + url,
      userData: { label: LABEL.PRODUCTS, category: name },
    })
  })
  await crawler.addRequests(requests)
})

router.addHandler(LABEL.PRODUCTS, async ({ crawler, $, request }) => {
  console.log(`handleProducts`, request.url)
  const PER_PAGE = 24
  if (!request.url.includes(`?f=`)) { // on first page
    const hasMore = !!$(`#CompoundPagingBottom a.nextProducts`).length
    const totalRaw = $(`#CompoundPagingBottom .displayedProducts`).text() // e.g. `Zobrazeno 1-24 ze 52 produktů`
    const total = parseInt(totalRaw.match(/ze (\d+) produktů/)[1]) // e.g. 52
    let offset = PER_PAGE // eg. 24, 48, 72, ...
    while (offset < total) {
      console.log(`handleProducts`, request.url, `offset`, offset, `...enqueuing`)
      const paginatedUrl = new URL(request.url)
      paginatedUrl.searchParams.set(`f`, offset.toString())
      void crawler.addRequests([{
        userData: { label: LABEL.PRODUCTS },
        url: paginatedUrl.toString(),
      }])
      offset += PER_PAGE
    }
  }

  const products = []
  $(`#ProductsHost .ProductView`).each((i, el) => {
    const id = $(el).attr(`id`)
    const url = $(el).find(`h2 a`).attr(`href`)
    const fullUrl = `https://www.ceskyraj.com` + url
    const title = $(el).find(`h2`).text()
    const priceRaw = $(el).find(`.price.user`).text() // `640&nbsp;Kč`
    const price = priceRaw.replace(/\D/g, ``)
    const priceOrigRaw = $(el).find(`.price.retail`).text() // `640&nbsp;Kč`
    const priceOrig = priceOrigRaw.replace(/\D/g, ``)
    const img = $(el).find(`.crImages img.thumbnail`).attr(`data-src`)
    const inStock = $(el).find(`.AvailabilityView`).text().includes(`skladem`)

    const product: Output = {
      pid: id,
      name: title,
      url: fullUrl,
      img: img,
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
  await init({ actorNameOverride: `ceskyraj-com` }, rest)
  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
