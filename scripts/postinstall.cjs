// Skip puppeteer browser install on Vercel (not needed for frontend)
if (!process.env.VERCEL) {
  const { execSync } = require('child_process');
  try {
    execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
  } catch (e) {
    console.log('Puppeteer browser install skipped');
  }
}
