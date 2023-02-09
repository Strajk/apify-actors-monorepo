/**
 * @title: Alza (alza.cz/sk/co.uk/de/at/hu) scraper
 * @description: Scrapes products titles, prices, images and availability. Does NOT scrape product details.
 * @apify.categories: ECOMMERCE
 * @apify.isPublic: true
 * */

/**
 * TODO:
 * - consider proxies
 * - DRY price parsing
 * - different countries to input
 *
 * Beware that same product can have multiple valid urls
 * - https://www.alza.cz/iphone-13-512gb-cervena-levne-d6839524.htm
 * - https://www.alza.cz/sport/victorias-secret-st-11128877-cc-4vmq-cerna
 * - https://www.alza.cz/sport/victorias-secret-st-11156655-cc-38h2-bezova?dq=6920061
 *
 * Variants can affect price
 * - https://www.alza.cz/asus-rog-zephyrus-g14-ga401?dq=6804643 38k
 * - https://www.alza.cz/asus-rog-zephyrus-g14-ga401?dq=6771118 39k
 *
 * Pagination:
 * beware: only first next 3 pages are listed
 * -> need to use total amount of products & product per page to calculate total amount of pages
 */

import { Actor, KeyValueStore } from "apify3"
import { CheerioCrawler, createCheerioRouter } from "crawlee"
import { createUniqueKeyFromUrl, init, save, toNumberOrNull } from "./_utils/common.js"

enum LABEL {
  INDEX = `INDEX`,
  PRODUCTS = `PRODUCTS`,
}

enum MODE {
  TEST = `TEST`, // @title: TEST mode (only few categories)
  FULL = `FULL`,
  SINGLE = `SINGLE`
}

enum Country {
  CZ = `CZ`,
  SK = `SK`,
  UK = `UK`,
  DE = `DE`,
  AT = `AT`,
  HU = `HU`,
}

const Countries = {
  [Country.CZ]: {
    domain: `cz`,
    currency: `CZK`,
  },
  [Country.SK]: {
    domain: `sk`,
    currency: `EUR`,
  },
  [Country.UK]: {
    domain: `co.uk`,
    currency: `GBP`,
  },
  [Country.DE]: {
    domain: `de`,
    currency: `EUR`,
  },
  [Country.AT]: {
    domain: `at`,
    currency: `EUR`,
  },
  [Country.HU]: {
    domain: `hu`,
    currency: `HUF`,
  },
}
type Input = {
  mode: MODE,
  country: Country,
  debug: boolean,
};

type Output = {
  pid: string, // e.g. 6731144
  name: string, // e.g. iPhone 13 Pro 128GB
  url: string, // e.g. https://alza.cz/iphone-13-pro-128gb-grafitovo-siva-d6731144.htm
  img: string, // e.g.
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 12990
  originalPrice: number, // e.g. 14990
  currency: string, // e.g. CZK
}

// Not totally happy with this, but good enough for now
const globalContext = { countryDef: null }

async function enqueueInitial (mode, crawler, countryDef) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([{
      userData: { label: LABEL.INDEX },
      url: `https://alza.${countryDef.domain}/_sitemap-categories.xml`,
    }])
  } else if (mode === MODE.TEST) {
    await crawler.addRequests(
      [
      `https://www.alza.cz/mikrofony/18843339.htm`,
      `https://www.alza.cz/beauty/kosmetika-pro-muze/18852935.htm`,
      `https://www.alza.cz/hobby/vybaveni-dilny/18862227.htm`,
      `https://www.alza.cz/sport/doplnky-na-kolo/18856256.htm`,
      ].map(url => ({
        userData: { label: LABEL.PRODUCTS },
        url,
      })),
    )
  } else if (mode === MODE.SINGLE) {
    await crawler.addRequests([{
      userData: { label: LABEL.PRODUCTS },
      url: `https://www.alza.sk/iphone-mobilne-telefony/18851638.htm`, // single category, but containing multiple pages
    }])
  }
}

const proxyGroups = [
  `HUNGARY`,
  `CZECH_LUMINATI`,
  `GERMANY`,
  `FRANCE`,
  `ITALY`,
  `SPAIN`,
]

const router = createCheerioRouter()

router.addHandler(LABEL.INDEX, async function ({ $, crawler }) {
  const urls = $(`url loc`).map((i, x) => $(x).text())
  const requests = []
  for (const url of urls) {
    requests.push({
      userData: { label: LABEL.PRODUCTS },
      url,
    })
  }
  await crawler.addRequests(requests)
})

router.addHandler(LABEL.PRODUCTS, async function ({ request, response, $, crawler }) {
  if ( // no pagination info in URL -> we are on a first/initial page -> enqueue next pages
    !request.url.match(/-p\d+\.htm/)
  ) {
    const totalAmountOfProducts = parseInt($(`#lblNumberItem`).text().replace(/\D/g, ``))
    const productsPerPage = 24 // TODO: Maybe to constant
    const totalPages = Math.ceil(totalAmountOfProducts / productsPerPage)
    for (let i = 2; i <= totalPages; i++) {
      const url = request.url // e.g. `/iphone-mobilne-telefony/18851638.htm`
        .replace(/\.htm$/, ``) // `/iphone-mobilne-telefony/18851638`
        .concat(`-p${i}.htm`) // e.g. `/iphone-mobilne-telefony/18851638-p2.htm`
      console.log(`enqueue next page`, url)
      void crawler.addRequests([{
        userData: { label: LABEL.PRODUCTS },
        url,
      }])
    }
  }

  const $items = $(`.browsingitem`)
  console.log(`Found ${$items.length} items`)
  if ($items.length === 0) {
    console.warn(`No items found on page, storing html response to keyValueStore for inspection`)
    await KeyValueStore.setValue(
      `noItems-${createUniqueKeyFromUrl(request.url)}`,
      response, /* when using CheerioCrawler */ // FIXME: Check that it does not need .body
      { contentType: `text/html` },
    )
  }
  $items.each(function () {
    const itemId = $(this).attr(`data-id`)
    const itemCode = $(this).attr(`data-code`) // non-standard product property
    const img = $(this).find(`a.pc.browsinglink img`).data(`src`)
    const relativeItemUrl = $(this)
      .find(`a.name.browsinglink`)
      .first()
      .attr(`href`)
    const absoluteItemUrl = `https://alza.${globalContext.countryDef.domain}${relativeItemUrl}`
    const itemName = $(this)
      .find(`a.name.browsinglink`)
      .first()
      .text()
      .replace(/([\n\r])/g, ``) // replace newlines and carriage returns
      .trim()

    const currentPriceRaw = $(`.price .c2, .price-box__price`, this)
      .text()

    // TODO: Find why $(this).find('.a, .b') is not the same as $('.a, .b', this)
    // const currentPriceRaw2 = $(this).find(`.price .c2, .price-box__price`)
    //   .text()
    // console.log({currentPriceRaw, currentPriceRaw2})

    const currentPrice = currentPriceRaw
      .replace(/,-$/, ``)
      .replace(/[^\d,.]/g, ``)

    // Note that Alza stopped using original & discounted prices in favour of "Good price"/"Super price" badges
    // So originalPrice is not always defined
    const originalPrice = $(this)
      .find(`.price .np2`).text()
      .replace(/,-$/, ``)
      .replace(/[^\d,.]/g, ``)

    const product: Output = {
      pid: itemId,
      name: itemName,
      url: absoluteItemUrl,
      img,
      inStock: true,
      currentPrice: toNumberOrNull(currentPrice),
      originalPrice: toNumberOrNull(originalPrice),
      currency: `CZK`, // countryDef.currency
    }
    console.log(`Found product: ${itemId}`)
    void save(product)
  })
})

void Actor.main(async () => {
  const input = await Actor.getInput() as Input
  const {
    mode = MODE.TEST, // FIXE: Full
    country = Country.CZ,
    ...rest
  } = input ?? {}
  await init({ actorNameOverride: `alza` }, rest)

  const countryDef = Countries[country]
  globalContext.countryDef = countryDef

  const crawler = new CheerioCrawler({ requestHandler: router })
  await enqueueInitial(mode, crawler, countryDef)
  await crawler.run()
})
