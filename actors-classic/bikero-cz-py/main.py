import logging

import scrapy
from price_parser import Price
from scrapy import Request

from utils import PostgresNoDuplicatesPipeline

logging.getLogger('scrapy').setLevel(logging.WARNING)  # This should be set from "the outside"

HOSTNAME = 'https://www.bikero.cz'
SHOP = 'bikero-cz'


class ShopSpider(scrapy.Spider):
  name = SHOP
  start_urls = ['https://www.bikero.cz/vyrobci-c56882/']
  custom_settings = {
    'ITEM_PIPELINES': {
      PostgresNoDuplicatesPipeline: 1,
    },
  }

  def parse(self, response: scrapy.http.Response) -> None:
    item_els = response.css('#ProductsMaster li.leaf a.name')
    for item_el in item_els:
      href = item_el.css('a::attr(href)').extract_first()
      print(f"Found category: {href}")
      yield Request(HOSTNAME + href, callback=self.parse_category)

  def parse_category(self, response: scrapy.http.Response) -> None:
    print(f"Parsing category: {response.url}")

    for item_el in response.css('#ProductListDefault .ProductView'):
      pid = item_el.css('::attr(data-clipboard)').extract_first()
      name = item_el.css('h2 ::text').extract_first()
      img = item_el.css('.image img::attr(data-src)').extract_first()
      price = item_el.css('.price.vat.primary.user .value::text').extract_first()
      price_orig = item_el.css('.price.vat.primary.retail .value::text').extract_first(default='')
      url = item_el.css('h2 a::attr(href)').extract_first()
      in_stock = item_el.css('.AvailabilityView .label::text').extract_first() == 'Skladem'
      product = {
        'shop': SHOP,
        'pid': pid,
        'name': name,
        'img': img,
        'price': Price.fromstring(price).amount_float,
        'price_orig': Price.fromstring(price_orig).amount_float if price_orig else None,
        'url': (HOSTNAME + url),
        'in_stock': in_stock,
        'currency': 'CZK',
      }
      print(f"Parsed product: {product}")
      yield product

    for next_page in response.css('#CompoundPagingBottom a.page:not(.active)'):
      print(f"Found pagination: {next_page.attrib['href']}")
      yield response.follow(next_page, self.parse_category)
