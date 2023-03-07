import os
from datetime import datetime

import psycopg
import scrapy
from dotenv import load_dotenv

load_dotenv('../../.env')
assert os.getenv('PG_CONNECTION_STRING_NORMALIZED'), 'PG_CONNECTION_STRING_NORMALIZED is not set'
assert os.getenv('PG_DATA_TABLE'), 'PG_DATA_TABLE is not set'
assert os.getenv('PG_DATA_PRICE_TABLE'), 'PG_DATA_PRICE_TABLE is not set'


def get_columns(dicts: object) -> object:
  first = dicts[0]  # assume all dicts have the same keys
  keys = first.keys()
  keys = [f'"{key}"' for key in keys]  # wrap keys in double quotes
  return ', '.join(keys)


def get_values(dicts: object) -> object:
  return ', '.join(['%s' for _ in dicts[0].keys()])

buffer = []

class PostgresNoDuplicatesPipeline:

  def __init__(self) -> None:
    self.connection = psycopg.connect(os.getenv('PG_CONNECTION_STRING_NORMALIZED'))
    self.cursor = self.connection.cursor()
    # check that tables exist
    self.cursor.execute("""
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    """)
    result = self.cursor.fetchall()
    assert (os.getenv('PG_DATA_TABLE'),) in result, f"Table {os.getenv('PG_DATA_TABLE')} does not exist"

  def process_item(self, item: scrapy.Item, spider: scrapy.Spider) -> None:
    buffer.append(item)
    if len(buffer) >= 10:
      self.flush()

  def flush(self) -> None:
    if len(buffer) == 0:
      return

    print(f"Flushing {len(buffer)} items")

    # Prepare data
    sql_data = []
    sql_data_price = []
    for item in buffer:
      sql_data.append({
        "shop": item['shop'],
        "pid": item['pid'],
        "name": item['name'],
        "url": item['url'],
        "img": item['img'],
      })
      sql_data_price.append({
        "shop": item['shop'],
        "pid": item['pid'],
        "scrapedAt": datetime.now().strftime("%Y-%m-%d"),
        "currentPrice": item['price'],
        "originalPrice": item['price_orig'],
        "inStock": item['in_stock'],
      })

    self.cursor.execute(f"""
      INSERT INTO public.{os.getenv('PG_DATA_TABLE')} ({get_columns(sql_data)})
      VALUES {', '.join([f'({get_values(sql_data)})' for _ in sql_data])}
      ON CONFLICT DO NOTHING
    """, [item for d in sql_data for item in d.values()])
    self.connection.commit()

    self.cursor.execute(f"""
      INSERT INTO public.{os.getenv('PG_DATA_PRICE_TABLE')} ({get_columns(sql_data_price)})
      VALUES {', '.join([f'({get_values(sql_data_price)})' for _ in sql_data_price])}
      ON CONFLICT DO NOTHING
    """, [item for d in sql_data_price for item in d.values()])
    self.connection.commit()

    buffer.clear()

  def close_spider(self, spider: scrapy.Spider) -> None:
    self.flush()
    self.cursor.close()
    self.connection.close()
