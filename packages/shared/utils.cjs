const removeAccents = require(`remove-accents`)

function toSafeName (name) {
  // Double check that it is safe for both apify and npm
  let transformed = name
    .replace(/\s/g, `-`)
    .replace(/[()]/g, ``) // there is already space before and after ()
    .replace(/\./g, `-`) // no dots
    .replace(/\//g, `-`) // no slashes
    .replace(/[><]/g, `-`) // no slashes
    .replace(/:/g, `-`) // no colons
    .toLowerCase()

  // replace multiple dashes with one
  transformed = transformed.replace(/-+/g, `-`)

  return removeAccents(transformed)
}

module.exports = {
  removeAccents,
  toSafeName,
}
