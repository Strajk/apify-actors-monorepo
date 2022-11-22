/**
 * @title: Axit (axit.cz) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details. Uses Crawlee (Apify v3).
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * @actor.base: hlidac-shopu
 * */

import { Actor } from "apify3"
import { CheerioCrawler, createCheerioRouter } from "crawlee"
import { gotScraping } from "got-scraping"
import cheerio from "cheerio"
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
  pid: string, // e.g. 172702
  name: string, // e.g. Shimano Deore XT M8100
  url: string, // e.g. https://www.axit.cz/d172702-shimano-deore-xt-m8100.html
  img: string, // e.g. https://www.axit.cz/images/172702/172702_1.jpg
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 2399
  originalPrice: number, // e.g. 2890
  currency: string, // e.g. CZK
}

async function enqueueInitial (type, crawler) {
  if (type === MODE.FULL) {
    await crawler.addRequests([{
      url: `https://www.axit.cz`,
      userData: { label: LABEL.INDEX },
    }])
  } else if (type === MODE.TEST) {
    const requests = [`shimano`, `crankbrothers`].map(brand => ({
      url: `https://www.axit.cz/vyrobci/${brand}`,
      userData: { label: LABEL.PRODUCTS, brand },
    }))
    await crawler.addRequests(requests)
  }
}

async function parseAndSaveProducts ($) {
  const products = []
  const $products = $(`.products .item`)
  $products.each(async (i, el) => {
    const relUrl = $(`a.image`, el).attr(`href`)
    const url = `https://www.axit.cz${relUrl}`

    // id = relUrl.match(/\/d(\d\w+)_/)[1] // e.g. /d123456_... -> 123456 // BEWARE: not every item has id in url
    const pid: any = $(el).find(`.compare`).attr(`id`).replace(`compare_add_`, ``) // e.g. compare_add_172702 -> 172702

    const name = $(`a.image`, el).attr(`title`)

    const priceRaw = $(el).find(`.price`).text().trim() // `640,00 Kč`
    const price = priceRaw.split(`,`)[0].replace(/\D/g, ``) // 2 999,00 Kč -> 2999

    const priceOrigRaw = $(el).find(`.original-price`).text().trim()
    const priceOrig = priceOrigRaw.replace(/\D/g, ``) // 3 990 Kč -> 3990
    const imgRel = $(`a.image img`, el).attr(`src`)
    const img = `https://www.axit.cz${imgRel}`

    const inStock = $(el).find(`.availability.instock`).length > 0

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
}

async function fetchProducts ({
  brandId,
  PHPSESSID,
  csrfToken,
  page,
}) {
  const ajaxRes = await gotScraping({
    url: `https://www.axit.cz/ajax/products_content.php`,
    method: `POST`,
    headers: {
      // Note: Some of the following headers are prob not needed
      "Content-Type": `application/x-www-form-urlencoded; charset=UTF-8`,
      "x-requested-with": `XMLHttpRequest`,
      referer: `https://www.axit.cz/vyrobci/shimano/`, // TODO
      cookie: `PHPSESSID=${PHPSESSID}`,
      origin: `https://www.axit.cz`,
      pragma: `no-cache`,
      "cache-control": `no-cache`,
      authority: `www.axit.cz`,
      accept: `*/*`,
      "accept-language": `en-US,en;q=0.9,cs;q=0.8,sk;q=0.7`,
    },
    form: {
      list_brand: brandId,
      cpage: page, // = page number
      epage: 80, // = per page
      razeni: `p_name`, // = sort by name
      CSRFtoken: csrfToken,

      nextpage: 0,
      categoryid: 0,
      subcategoryid: 0,
      subsubcategoryid: 0,
      subsubsubcategoryid: 0,
      cphrase: ``,
      list_label: 0,
      base_products: ``,
      // eprice: 0 - 13150,
      // eprice2: 0 - 13150,
      initialize: 1,
    },
  })
  const ajaxBody = ajaxRes.body // kinda weird HTML https://share.cleanshot.com/pFGlpy
  return cheerio.load(ajaxBody)
}

const router = createCheerioRouter()

router.addHandler(LABEL.INDEX, async function ({ $, crawler }) {
  const requests = []
  $(`#header .maker a[href^="/vyrobci"]`).each((i, el) => {
    // /vyrobci/shimano/ -> shimano
    const slug = $(el).attr(`href`)
      .replace(`/vyrobci/`, ``)
      .replace(/\/$/, ``) // replace trailing slash
    requests.push({
      url: `https://www.axit.cz/vyrobci/${slug}/#razeni=p_name`,
      userData: { label: LABEL.PRODUCTS, brand: slug },
    })
  })
  await crawler.addRequests(requests)
})
router.addHandler(LABEL.PRODUCTS, async function ({ request, response, $ }) {
  const { userData } = request

  const brandId = $(`input[name="list_brand"]`).attr(`value`)
  if (!brandId) {
    console.log(`No brandId found for ${userData.brand} – that does not mean anything, just FYI`)
    console.log(`Url: ${request.url}`)
    return
  }

  const setCookieResHeader = response.headers[`set-cookie`][0] // PHPSESSID=abc133; expires=Mon, 05-Sep-2022 12:31:52 GMT; Max-Age=172800; path=/; secure
  const PHPSESSID = setCookieResHeader.split(`;`)[0].split(`=`)[1] // abc133
  if (!PHPSESSID) throw new Error(`PHPSESSID not found`)

  const csrfToken = $(`input[name="CSRFtoken"]`).attr(`value`)
  if (!csrfToken) throw new Error(`CSRFtoken not found`)

  // Pagination – Axit does not show the last page, only that there are more pages
  let hasMorePages = true
  let page = 0
  while (hasMorePages) {
    const $ajax: any = await fetchProducts({
      brandId,
      PHPSESSID,
      csrfToken,
      page,
    })
    console.log(`fetchProducts`, { brand: userData.brand, brandId, page, products: $ajax(`.products .item`).length })
    await parseAndSaveProducts($ajax)
    if ($ajax(`.pagination [rel=next]`).length) {
      page++
    } else {
      hasMorePages = false
    }
  }
})

void Actor.main(async () => {
  const input = await Actor.getInput() as Input
  const {
    mode = MODE.FULL,
    ...rest
  } = input ?? {}
  await init({ actorNameOverride: `axit-cz` }, rest)
  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler)
  await crawler.run()
})
