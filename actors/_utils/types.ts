export type HlidacShopuCompatProduct = {
  itemId: string, // e.g. p1390167
  itemName: string, // e.g. Pedály Crankbrothers Stamp 7 orange
  itemUrl: string, // e.g. https://www.ceskyraj.com/pedaly-crankbrothers-stamp-7-orange-p1141669/
  img: string, // e.g.
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 3896
  originalPrice: number, // e.g. 3999
  currency: string, // e.g. CZK
}

export type HlidacShopuProductNew = {
  pid: string, // e.g. p1390167
  name: string, // e.g. Pedály Crankbrothers Stamp 7 orange
  url: string, // e.g. https://www.ceskyraj.com/pedaly-crankbrothers-stamp-7-orange-p1141669/
  img: string, // e.g.
  inStock: boolean, // e.g. true
  currentPrice: number, // e.g. 3896
  originalPrice: number, // e.g. 3999
  currency: string, // e.g. CZK
}

export type MODE = `TEST` | `FULL`;
