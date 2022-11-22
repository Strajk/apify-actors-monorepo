/**
 * @title: Team Sport (teamsport.cz) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details.
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * @actor.base: hlidac-shopu
 * */

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
  pid: string, // e.g. pk179297
  name: string, // e.g. Boty Five Ten Hellcat Pro Black Hazy
  url: string, // e.g. https://www.teamsport.cz/boty-five-ten-hellcat-pro-black-hazy/
  img: string, // e.g.
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 3799
  originalPrice: number, // e.g. 4199
  currency: string, // e.g. CZK
}

// TODO: Solve ?listcnt nicer

async function enqueueInitial (type, crawler) {
  if (type === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABEL.INDEX },
      url: `https://www.teamsport.cz/znacky/`,
    }])
  } else if (type === MODE.TEST) {
    await crawler.addRequests([{
      userData: { label: LABEL.PRODUCTS },
      url: `https://www.teamsport.cz/bbb/`,
    }, {
      userData: { label: LABEL.PRODUCTS },
      url: `https://www.teamsport.cz/five-ten/`,
    }, {
      userData: { label: LABEL.PRODUCTS },
      url: `https://www.teamsport.cz/fox-racing/`,
    }])
  }
}

const router = createCheerioRouter()

router.addHandler(LABEL.INDEX, async ({ crawler, $ }) => {
  const requests = []
  $(`.commonListVyrobcu .listLinks a`).each((i, el) => {
    const url = $(el).attr(`href`)
    const name = $(el).text()
    requests.push({
      userData: { label: LABEL.PRODUCTS, category: name },
      url: url + `?listcnt=999`,
    })
  })
  await crawler.addRequests(requests)
})

router.addHandler(LABEL.PRODUCTS, async ({ crawler, $ }) => {
  const products = []
  $(`.categoryProducts article.product`).each((i, el) => {
    const id = $(el).find(`[data-productid]`).attr(`data-productid`)
    const url = $(el).find(`a.product__href`).attr(`href`)
    const title = $(el).find(`a.product__href`).attr(`title`)
    const priceRaw = $(el).find(`.product__wrapper__inner__price__new`).text() // `640&nbsp;Kč`
    const price = priceRaw.replace(/\D/g, ``)
    const priceOrigRaw = $(el).find(`.product__wrapper__inner__price__old`).text() // `640&nbsp;Kč`
    const priceOrig = priceOrigRaw.replace(/\D/g, ``)
    const img = $(el).find(`.product__img__src`).attr(`src`)
    const product: Output = {
      pid: id,
      name: title,
      url: url,
      img: img,
      inStock: true, // FIXME: either style='color:#29b237;' or 'skladem'
      currentPrice: toNumberOrNull(price),
      originalPrice: toNumberOrNull(priceOrig),
      currency: `CZK`,
    }
    products.push(product)
  })
  void save(products)
},
)

void Actor.main(async () => {
  const input = await Actor.getInput() as Input
  const {
    mode = MODE.FULL,
    ...rest
  } = input ?? {}
  await init({ actorNameOverride: `teamsport-cz` }, rest)
  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
