import { Actor } from "apify3";
import {
  CheerioCrawler,
  createCheerioRouter,
  utils as crawleeUtils,
} from "crawlee";
import { Session } from "@crawlee/core";
import playwright from "playwright";
import { init, parsePrice, save, toNumberOrNull } from "./_utils/common.js";

const LABELS = {
  INDEX: `INDEX`,
  PRODUCTS: `PRODUCTS`,
};

var MODE;

(function (MODE) {
  MODE["TEST"] = "TEST";
  MODE["FULL"] = "FULL";
})(MODE || (MODE = {}));

async function enqueueInitial(mode, crawler) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([
      {
        userData: { label: LABELS.INDEX },
        url: `https://r2-bike.com/en/brands`,
      },
    ]);
  } else if (mode === MODE.TEST) {
    await crawler.addRequests([
      {
        userData: { label: LABELS.PRODUCTS },
        url: `https://r2-bike.com/en/shimano`,
      },
    ]);
  }
}

const router = createCheerioRouter();

router.addHandler(LABELS.INDEX, async ({ enqueueLinks }) => {
  await enqueueLinks({
    selector: `.vendor-index-group-wrapper li a`, // e.g. `en/shimano`
    baseUrl: `https://r2-bike.com/`, // needed for correctly absolute URLs, otherwise it would be `https://r2-bike.com/en/en/shimano`, not sure why ¯\_(ツ)_/¯
    userData: { label: LABELS.PRODUCTS },
  });
});

router.addHandler(LABELS.PRODUCTS, async ({ crawler, $, request, log }) => {
  log.info(`[PRODUCTS] ${request.url}`);

  if (!request.url.match(/_s(\d+)$/)) {
    // on first page
    const paginationText = $(`.list-pageinfo .page-current`).text().trim(); // eg. `Page 1 of 11`
    const match = paginationText.match(/(\d+) of (\d+)/);
    if (!match)
      log.error(
        `[PRODUCTS] Failed to parse pagination text: ${paginationText}`
      );
    const [, currentPage, totalPages] = match ?? [];
    if (Number(totalPages) > 1)
      log.info(`[PRODUCTS] Found ${totalPages} pages, enqueuing`);
    for (let i = 2; i <= Number(totalPages); i++) {
      // skip first page, that is already handled
      void crawler.addRequests([
        {
          url: `${request.url}_s${i}`, // eg. https://r2-bike.com/en/shimano_s2
          userData: { label: LABELS.PRODUCTS },
        },
      ]);
    }
  }

  const products = [];
  const $products = $(
    `#product-list .product-wrapper[itemprop="itemListElement"]`
  ); // itemprop to avoid selecting last fake tile, which is actually "Next page" link
  log.info(`[PRODUCTS] ${request.url} - found ${$products.length} products`);
  $products.each(async (i, el) => {
    const pid = $(`.product-cell`, el)
      .attr(`id`) // result-wrapper_buy_form_106016
      ?.replace(`result-wrapper_buy_form_`, ``); // 106016
    if (!pid)
      return log.error(
        `[PRODUCTS] Failed to parse pid from ${i + 1}th product on ${
          request.url
        }`
      );

    const url = $(`meta[itemprop="url"]`, el).attr(`content`);
    const img = $(`meta[itemprop="image"]`, el).attr(`content`);
    const name = $(`h4[itemprop="name"]`, el).text().trim();

    const priceRaw = $(`.price_wrapper .price`, el).text().trim(); // e.g. 1,98 €*
    const price = parsePrice(priceRaw).amount;

    const priceOrigRaw = $(`.price-uvp`, el).text().trim(); // e.g. MSRP: 5,95 €
    const priceOrig = parsePrice(priceOrigRaw).amount;

    const inStock = $(`.delivery-status`, el).text().includes(`available`);

    const product = {
      pid,
      name,
      url,
      img,
      inStock,
      currentPrice: toNumberOrNull(price),
      originalPrice: toNumberOrNull(priceOrig),
      currency: `EUR`,
    };
    products.push(product);
  });
  await save(products);
});

void Actor.main(async () => {
  const input = await Actor.getInput();
  const { mode = MODE.FULL, ...rest } = input ?? {};
  await init({ actorNameOverride: `r2-bike-com` }, rest);
  const crawler = new CheerioCrawler({
    requestHandler: router,
    preNavigationHooks: [
      async ({ session }, gotOptions) => {
        const userData = session.userData;
        gotOptions.headers = userData.headers; // real-like headers obtained from Firefox
        gotOptions.headers.Cookie = userData.cookies
          .map((c) => `${c.name}=${c.value}`)
          .join(`; `); // real cookies obtained from Firefox
        // gotOptions.proxyUrl = `http://127.0.0.1:9090` // NOTE: uncomment for local debugging
      },
    ],
    maxConcurrency: 1, // not brave enough for concurrency
    maxRequestRetries: 0, // not brave enough for concurrency
    sessionPoolOptions: {
      maxPoolSize: 1, // not brave enough for concurrency
      sessionOptions: {
        maxAgeSecs: 60 * 60 * 2, // 2 hours, default is 50m
        maxUsageCount: 1000, // default is 50, let's use as much as possible, until we get blocked
      },
      createSessionFunction: async (sessionPool) => {
        console.log(
          `[SESSION] Creating new session, will use Firefox to unblock (should take ~10s)`
        );
        const session = new Session({ sessionPool });
        await unblock(session);
        return session;
      },
    },
  });
  await enqueueInitial(mode, crawler);
  await crawler.run();
});

async function unblock(session) {
  const browser = await playwright.firefox.launch({
    // headless: false, // NOTE: uncomment for debugging
    // proxy: { server: `http://127.0.0.1:9090` }, // NOTE: uncomment for local debugging
  });
  const browserContext = await browser.newContext({ ignoreHTTPSErrors: true });
  await browserContext.addCookies([
    {
      name: `eu_cookie_store`,
      value: `{"b209404849c0357500f7a82a6899961a":true,"3940b498c8a17157f69d757a80ff3421":true,"1d3c65b2b03ef35e14df6b163ea3a1f6":false,"0a3fbfc21a86a28c8961999929c374f3":true,"9b88c95a15e018c3f8038a7d0160145c":true,"dd31d974a78cdd704acaa6bf15da506c":true,"d86cf69a8b82547a94ca3f6a307cf9a6":false,"d323dff6f7de41c0b9af4c35e21dc032":false,"b83d1ac867f35569c614e298f645fffe":true,"21affb15e1316adac24b26db8e421a9d":false,"2d1fc55f933c039b2e04ff9034134b4d":true,"4d60ab2c6d11d753267484006c23e54c":false,"970cfba66b8380fb97b742e4571356c6":false}`,
      domain: `r2-bike.com`,
      path: `/`,
    },
    {
      name: `r2_user_delivery_country`,
      value: `CZ`, // TODO: make it configurable
      domain: `r2-bike.com`,
      path: `/`,
    },
    {
      name: `r2_user_delivery_country_ip_backup`,
      value: `CZ`, // TODO: make it configurable
      domain: `r2-bike.com`,
      path: `/`,
    },
    {
      name: `r2_user_delivery_country_tax_1`,
      value: `21`, // TODO: make it configurable
      domain: `r2-bike.com`,
      path: `/`,
    },
    {
      name: `r2_user_delivery_country_tax_2`,
      value: `10`, // TODO: make it configurable
      domain: `r2-bike.com`,
      path: `/`,
    },
    {
      name: `ledgerCurrency`,
      value: `EUR`,
      domain: `r2-bike.com`,
      path: `/`,
    },
  ]);

  const page = await browserContext.newPage();
  // page.on(`console`, msg => console.log(`⚪️ Playwright log (${msg.type()}) ${msg.text()}`))

  let headersToSet;

  await page.route(`**/*`, (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method(); // GET, POST, etc.
    const resourceType = request.resourceType(); // document, stylesheet, image, ...
    // console.log(`🔵 Playwright route: ${method} ${url} (${resourceType})`)

    // use the first main request to store the sent headers
    if (!headersToSet) headersToSet = pickHeaders(request.headers());

    route.continue();
  });

  // Go to product listing page which sets 95 products per page to current session
  await page.goto(`https://r2-bike.com/navi.php?h=58&Sortierung=1&af=95`); // h=58 is "Shimano", Sortierung=1 is "Sort by name" – both are not important, but some values need to be set
  // Wait for some time to pass basic Cloudflare Javascript checks
  await crawleeUtils.sleep(5000); // TODO: Be smarter, 3000s is enough for r2-bike.com, but not for g2.com
  // Get all cookies and store them for subsequent requests
  const cookies = await page.context().cookies();
  session.userData = { headers: headersToSet, cookies };
}

function pickHeaders(headers) {
  // Pick just the headers that gotScraping can correctly handle (= order)
  // This seems to be needed mainly to avoid setting Host header, which when set, was at the end of the headers list, which Cloudflare did not like
  //   If we skip the Host header, then gotScraping will set it automatically, and in the correct order

  // taken from https://github.com/apify/header-generator/blob/1b0fd217b6fa0beaf42b9de321e47ac5f1d4cebf/src/data_files/headers-order.json#L62
  const headersList = [
    `sec-ch-ua`,
    `sec-ch-ua-mobile`,
    `user-agent`,
    `User-Agent`,
    `accept`,
    `Accept`,
    `accept-language`,
    `Accept-Language`,
    `accept-encoding`,
    `Accept-Encoding`,
    `dnt`,
    `DNT`,
    `referer`,
    `Referer`,
    `cookie`,
    `Cookie`,
    `Connection`,
    `upgrade-insecure-requests`,
    `Upgrade-Insecure-Requests`,
    `te`,
    `sec-fetch-site`,
    `sec-fetch-mode`,
    `sec-fetch-user`,
    `sec-fetch-dest`,
    `Sec-Fetch-Mode`,
    `Sec-Fetch-Dest`,
    `Sec-Fetch-Site`,
    `Sec-Fetch-User`,
  ];
  return headersList.reduce((acc, header) => {
    if (headers[header]) acc[header] = headers[header];
    return acc;
  }, {});
}
