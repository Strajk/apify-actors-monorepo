import { URL } from "node:url";
import { Actor } from "apify3";
import {
  CheerioCrawler,
  createCheerioRouter,
  utils as crawleeUtils,
} from "crawlee";
import playwright from "playwright";
import { Session } from "@crawlee/core";
import { init, save } from "./_utils/common.js";

const LABELS = {
  INDEX: `INDEX`,
  PRODUCTS: `PRODUCTS`,
};

var MODE;

(function (MODE) {
  MODE["TEST"] = "TEST";
  MODE["FULL"] = "FULL";
})(MODE || (MODE = {}));

const BASE_URL = `https://www.bike24.com`;

async function enqueueInitial(mode, crawler) {
  if (mode === MODE.FULL) {
    await crawler.addRequests([
      {
        userData: { label: LABELS.INDEX },
        url: `https://www.bike24.com/brands`,
      },
    ]);
  } else if (mode === MODE.TEST) {
    await crawler.addRequests([
      {
        userData: { label: LABELS.PRODUCTS },
        url: `https://www.bike24.com/brands/100percent`,
      },
    ]);
  }
}

const router = createCheerioRouter();

router.addHandler(LABELS.INDEX, async ({ crawler, $ }) => {
  $(`.list-brands-sitemap__section-item a`).each((i, el) => {
    const url = $(el).attr(`href`); // urls are relative
    const fullUrl = `${BASE_URL}${url}`;
    const name = $(el).text().trim(); // there's extra space at the beginning and end
    void crawler.addRequests([
      {
        userData: { label: LABELS.PRODUCTS, category: name },
        url: fullUrl,
      },
    ]);
  });
});

router.addHandler(LABELS.PRODUCTS, async ({ crawler, $, request }) => {
  if (!request.url.includes(`page=`)) {
    // on first page
    const totalPages = Number($(`.page-pagination-item`).last().text()); // e.g. `12`
    // FIXME:
    for (let i = 2; i <= Math.min(totalPages, 3); i++) {
      // skip first page, that is already handled
      const url = new URL(request.url);
      url.searchParams.set(`page`, i.toString());
      void crawler.addRequests([
        {
          url: url.toString(),
          userData: {
            label: LABELS.PRODUCTS,
            category: request.userData.category, // pass category name
          },
        },
      ]);
    }
  }

  const TAX_RATE = 1.21;

  const products = [];
  const $products = $(`.product-tile`);
  $products.each((i, el) => {
    const pid = $(el)
      .find(`.product-tile__anchor`)
      .attr(`href`)
      .replace(/\D/g, ``); // e.g. `p2421335.html` -> `2421335
    const relUrl = $(el).find(`.product-tile__anchor`).attr(`href`); // relative url
    const url = `${BASE_URL}${relUrl}`;
    const name = $(el).find(`.product-tile__title`)?.text()?.trim();
    const prices = JSON.parse($(`.productPrice`, el).attr(`data-props`));
    const img = $(el).find(`.product-tile__picture img`).attr(`src`);
    const inStock = !!$(`.delivery-message--success`).length;
    const product = {
      pid,
      name,
      url,
      img,
      inStock,
      currentPrice: prices.price * TAX_RATE,
      originalPrice: prices.oldPrice
        ? prices.oldPrice * TAX_RATE
        : prices.price * TAX_RATE,
      currency: `EUR`,
    };
    products.push(product);
  });
  await save(products);
});

void Actor.main(async () => {
  const input = await Actor.getInput();
  const {
    mode = MODE.FULL,
    proxyConfiguration: inputProxyConfiguration,
    ...rest
  } = input ?? {};

  // TODO: Better pattern to handle both proxy and no proxy
  const proxyConfiguration = inputProxyConfiguration
    ? await Actor.createProxyConfiguration(inputProxyConfiguration)
    : undefined;

  await init({ actorNameOverride: `bike-24` }, rest);
  const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: 1,
    maxRequestRetries: 0,
    sessionPoolOptions: {
      maxPoolSize: 1, // not brave enough for concurrency
      sessionOptions: {
        maxAgeSecs: 60 * 60 * 2, // 2 hours, default is 50m
        maxUsageCount: 1000, // default is 50, let's use as much as possible, until we get blocked
        // TODO: Investigate why so many Firefox sessions are created
      },
      createSessionFunction: async (sessionPool) => {
        console.log(
          `[SESSION] Creating new session, will use Firefox to unblock (should take ~10s)`
        );
        const session = new Session({ sessionPool });
        await unblock(session, proxyConfiguration);
        return session;
      },
    },
    persistCookiesPerSession: true,
    preNavigationHooks: [
      async ({ session }, gotOptions) => {
        const userData = session.userData;
        gotOptions.headers = userData.headers; // real-like headers obtained from Firefox
        gotOptions.headers.Cookie = userData.cookies
          .map((c) => `${c.name}=${c.value}`)
          .join(`; `); // real cookies obtained from Firefox
        // gotOptions.proxyUrl = `http://127.0.0.1:9090` // NOTE: uncomment for debugging with MITM
      },
    ],
    requestHandler: router,
  });
  await enqueueInitial(mode, crawler);
  await crawler.run();
});

async function unblock(session, proxyConfiguration) {
  const browser = await playwright.firefox.launch({
    headless: true, // NOTE: uncomment for debugging
    // TODO: Better pattern to handle both proxy and no proxy
    proxy: proxyConfiguration
      ? { server: await proxyConfiguration.newUrl(session.id) }
      : undefined,
    // proxy: { server: `http://127.0.0.1:9090` }, // NOTE: uncomment for debugging with MITM
  });
  const browserContext = await browser.newContext({ ignoreHTTPSErrors: true });

  const countryCode = `29`;
  await browserContext.addCookies([
    {
      name: `countryTax`,
      value: `{"shippingCountry":${countryCode},"taxRates":[{"value":21,"name":"Normaler Mehrwertsteuersatz","taxGroup":1},{"value":15,"name":"Lebensmittel mit red. MwSt.","taxGroup":2},{"value":15,"name":"Druckerzeugnisse","taxGroup":3}],"validUntil":"Wednesday, 16-Nov-2022 00:00:00 UTC"}`, // FIXME
      domain: `www.bike24.com`,
      path: `/`,
    },
    {
      name: `deliveryLocation`,
      value: `{"country":${countryCode},"zipCode":null}`,
      domain: `www.bike24.com`,
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

  await page.goto(`https://www.bike24.com/brands/shimano`);
  // Wait for some time to pass basic Cloudflare Javascript checks
  await crawleeUtils.sleep(5000); // TODO: Be smarter, 3000s is enough for r2-bike.com, but not for g2.com
  // Get all cookies and store them for subsequent requests
  const cookies = await page.context().cookies();
  // eslint-disable-next-line dot-notation
  const cfCookie = cookies.find((c) => c.name === `__cf_bm`).value;
  console.log(
    `[SESSION] Cloudflare cookie "__cf_bm": ${cfCookie ?? `😱😱😱 not found`}`
  );
  session.userData = { headers: headersToSet, cookies };
  await browser.close();
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

    // Handling cookies explicitly
    // `cookie`,
    // `Cookie`,

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
