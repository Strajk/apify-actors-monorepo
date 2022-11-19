/* WIP */

import path from "path"
import fs from "fs"

// Overview
// ===
const readmeFilepath = path.resolve(process.cwd(), `..`, `README.md`)
const currentContent = fs.readFileSync(readmeFilepath, `utf-8`)
let overviewMdHeader = `|Title|Crawler|\n`
overviewMdHeader += `|---|---|`
const overviewMd = Object.entries(collectors).reduce((acc, [key, collector]) => {
  if (collector.draft) return acc // TODO: Document
  acc += `\n`
  acc += `|${collector.title}|${collector.crawlerName}|`
  return acc
}, overviewMdHeader)
const updatedContent = currentContent.replace(
  /<!-- <readme-overview> -->.+<!-- <\/readme-overview> -->/sm,
  `<!-- <readme-overview> -->\n${overviewMd}\n<!-- </readme-overview> -->`,
)
fs.writeFileSync(readmeFilepath, updatedContent)
