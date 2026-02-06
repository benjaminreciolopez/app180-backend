const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  // Configurar la caché dentro del proyecto para asegurar que Render la encuentre
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
