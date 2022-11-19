# r2-bike (r2-bike.com) scraper

Scrapes products titles, prices, images and availability. Does NOT scrape product details. Uses Crawlee (Apify v3).

## Output example

* **pid** `string` e.g. *106018*
* **name** `string` e.g. *SHIMANO 105 R7000*
* **url** `string` e.g. *https://r2-bike.com/SHIMANO-105-R7000*
* **img** `string` e.g. *https://cdn.r2-bike.com/SHIMANO-105-R7000.jpg*
* **inStock** `boolean` e.g. *true*
* **currentPrice** `number` e.g. *19.95*
* **originalPrice** `number` e.g. *39.95*
* **currency** `string` e.g. *EUR*