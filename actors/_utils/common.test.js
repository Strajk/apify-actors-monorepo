/* eslint-env jest */
import * as common from "./common.js"

test(`parsePrice`, () => {
  const fn = common.parsePrice
  expect(fn(`1.099 €`)).toEqual({ amount: 1099, currency: undefined })
  expect(fn(`10.999 €`)).toEqual({ amount: 10999, currency: undefined })
  expect(fn(`124.99€`)).toEqual({ amount: 124.99, currency: undefined })
  expect(fn(`1.271,01 €`)).toEqual({ amount: 1271.01, currency: undefined })
  expect(fn(` <span>from</span>  120.99€`)).toEqual({ amount: 120.99, currency: undefined })
})
