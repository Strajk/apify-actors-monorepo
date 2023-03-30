## Contributing new shop scraper

Beware: Not super polished, just writing down how it is.

#### Verify that the dev stack works on existing scraper (bike-discount-de):

- `npm i --legacy-peer-deps`
- `cd actors && npm i --legacy-peer-deps`
- open the `actors/bike-discount.ts` file in VSCode (important because predefined launch config uses `${relativeFile}`)
- Run > Start Debugging (or `F5`)
- Terminal should open, scraper should start running, logs should start appearing, you should see sth like:
  - `Starting the crawl`
  - ...
  - `handleCategory https://www.bike-discount.de/en/adidas`
  - ...
  - `Crawl finished`
  - `Terminal status message: Finished! Total 917 requests: 917 succeeded, 0 failed.` (numbers may vary)
- Scraped data should appear in `actors/bike-discount-de.storage` folder
- Pick few random files and check that the data looks good
- Don't forget you can also use debugger!
- It should look like this https://share.cleanshot.com/RCYdjTCQ

#### Create a new scraper

- Create a new file in `actors` folder, e.g. `actors/decathlon-cz.ts`
- Do your best, take inspiration from existing scrapers
- Submit PR
- When running on the platform, it will automatically save the results to database instead of the file system. No need to worry about that :)
