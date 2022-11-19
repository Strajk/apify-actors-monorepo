/* eslint-env jest */
const fn = require(`./deps`)

test(`deps`, () => {
  expect(fn(
    {
      '/users/strajk/foo/node_modules/apify/build/index.js': {
        '/users/strajk/foo/node_modules/tslib/tslib.es6.js': {},
        '/users/strajk/foo/node_modules/apify/build/main.js': {},
      },
      '/users/strajk/foo/node_modules/cheerio/lib/index.js': {
        '/users/strajk/foo/node_modules/tslib/tslib.es6.js': {},
        '/users/strajk/foo/node_modules/cheerio/lib/types.js': {},
      },
      '/users/strajk/foo/node_modules/lodash/lodash.js': {},
      '/users/strajk/foo/node_modules/got-scraping/dist/index.js': {
        '/users/strajk/foo/node_modules/tslib/tslib.es6.js': {},
        '/users/strajk/foo/node_modules/got-cjs/dist/source/index.js': {},
        '/users/strajk/foo/node_modules/header-generator/src/main.js': {},
        '/users/strajk/foo/node_modules/got-scraping/dist/agent/transform-headers-agent.js': {},
      },
      '/users/strajk/foo/actors/_utils/stats.js': {
        '/users/strajk/foo/node_modules/apify/build/index.js': {},
        '/users/strajk/foo/node_modules/@thi.ng/atom/index.js': {},
        '/users/strajk/foo/actors/_utils/tools.js': {
          '/users/strajk/foo/node_modules/lodash/lodash.js': {},
        },
      },
    },
    `/users/strajk/foo/`,
  )).toEqual({
    localDeps: [
      `actors/_utils/stats.js`,
      `actors/_utils/tools.js`,
    ],
    npmDeps: [
      `apify`,
      `cheerio`,
      `lodash`,
      `got-scraping`,
      `@thi.ng/atom`,
    ],
  })
})
