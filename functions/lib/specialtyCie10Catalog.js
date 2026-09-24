const labels = require('./clinicalCie10Catalog.json');

/** The same CIE-10 code/description source shipped to the browser, packaged with Functions. */
const getCie10Label = code => typeof labels[code] === 'string' ? labels[code] : null;
/** For valid codes absent from the catalog, send the code alone; never patient text. */
const resolveCie10Label = code => getCie10Label(code) ||
  (/^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,4})?$/.test(code) ? `CIE-10 ${code}` : null);

module.exports = { getCie10Label, resolveCie10Label };
