import { Actor } from "apify3"
import { CheerioCrawler, createCheerioRouter } from "crawlee"
import { init, parsePrice, save } from "./_utils/common.js"

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

const router = createCheerioRouter()

const crawler = new CheerioCrawler({
  requestHandler: router,
})

const LABELS = {
  INDEX: `INDEX`, // brands
  PRODUCTS: `PRODUCTS`,
}

router.addHandler(LABELS.INDEX, async ({ $ }) => {
  const requests = []
  $(`.list a`).each((i, el) => {
    const url = $(el).attr(`href`) // urls are absolute
    const name = $(el).text().trim() // there's extra space at the beginning and the end
    requests.push({
      userData: { label: LABELS.PRODUCTS, category: name },
      url: `https://www.centrumrowerowe.pl${url}`,
    })
  })
  void crawler.addRequests(requests)
})

router.addHandler(LABELS.PRODUCTS, async ({ $, request, crawler }) => {
  if (!request.url.includes(`?page=`)) { // only do on first page
    const totalProducts = +$(`.products-number`).text().trim()
    const itemsPerPage = 30
    const totalPages = Math.ceil(totalProducts / itemsPerPage)
    for (let page = 2; page <= totalPages; page++) {
      await crawler.addRequests([{
        url: `${request.url}?page=${page}`,
        userData: { label: LABELS.PRODUCTS },
      }])
    }
  }

  const products = []
  const productElements = $(`#list .list-wrapper .product-tile`)

  productElements.each((i, el) => {
    const intPrice = $(el).find(`.final-price .int-part`).text()
    const decPrice = $(el).find(`.final-price .dec-part`).text().replace('zł', '').trim()
    const originalPrice = $(el).find(`.discount .old`).text().replace('zł', '').trim()

    const name = $(el).find(`.name a.gtm-detail-link`).text().trim()
    const url = $(el).find('a.gtm-detail-link').attr(`href`)
    const img = $(el).find(`a.gtm-detail-link img`).attr(`src`)

    if (!name || !url) return

    const product: Output = {
      pid: $(el).attr(`id`),
      name,
      url,
      img,
      inStock: true, // this site only shows things that are in stock
      currentPrice: parsePrice(`${intPrice}${decPrice}`),
      originalPrice: originalPrice ? parsePrice(originalPrice) : undefined,
      currency: `PLN`,
    }

    products.push(product)
  })
  await save(products, request, { debug: true })
})

async function enqueueInitial(crawler) {
  await crawler.addRequests([{
    userData: { label: LABELS.INDEX },
    url: `https://www.centrumrowerowe.pl/marki`,
  }])
}


void Actor.main(async () => {
  await init({ actorNameOverride: `centrumrowerowe-pl` })
  await enqueueInitial(crawler)
  await crawler.run()
})
