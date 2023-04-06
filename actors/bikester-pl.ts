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
  $(`.dictionary-list-item ul.brands li a`).each((i, el) => {
    const url = $(el).attr(`href`) // urls are absolute
    const name = $(el).text().trim() // there's extra space at the beginning and the end
    requests.push({
      userData: { label: LABELS.PRODUCTS, category: name },
      url: `https://www.bikester.pl${url}`,
    })
  })
  void crawler.addRequests(requests)
})

router.addHandler(LABELS.PRODUCTS, async ({ $, request, crawler }) => {
  if (!request.url.includes(`?page=`)) { // only do on first page
    const totalProducts = +$(`.scroll-pivot span.cyc-typo_subheader`).attr('data-value')
    const itemsPerPage = 48
    const totalPages = Math.ceil(totalProducts / itemsPerPage)
    for (let page = 2; page <= totalPages; page++) {
      await crawler.addRequests([{
        url: `${request.url}?page=${page}`,
        userData: { label: LABELS.PRODUCTS },
      }])
    }
  }

  const products = []
  const productElements = $(`.product-tile`)

  productElements.each((i, el) => {
    const name = $(el).find(`.product-name`).text().trim()
    const url = $(el).find('a.thumb-link').attr(`href`) // Absolute URLs
    // There is also a disabled IMG tag, so target the non-disabled
    const img = $(el).find(`.product-image img`).first().attr('src')

    const discountPrice = $(el).find(`.price-sales`).text().replace('zł', '').trim()
    const originalPriceSelector = discountPrice
      ? `.product-price .price-standard .retail-price`
      : `.product-price .price-standard`
    const originalPrice = $(el).find(originalPriceSelector).text().replace('zł', '').trim()

    const product: Output = {
      pid: $(el).attr(`data-productid`),
      name,
      url,
      img,
      currentPrice: discountPrice ? parsePrice(discountPrice) : undefined,
      originalPrice: originalPrice ? parsePrice(originalPrice) : undefined,
      currency: `PLN`,
      inStock: true,
    }

    products.push(product)
  })
  await save(products, request, { debug: true })
})

async function enqueueInitial(crawler) {
  await crawler.addRequests([{
    userData: { label: LABELS.INDEX },
    url: `https://www.bikester.pl/marki`,
  }])
}


void Actor.main(async () => {
  await init({ actorNameOverride: `bikester-pl` })
  await enqueueInitial(crawler)
  await crawler.run()
})
