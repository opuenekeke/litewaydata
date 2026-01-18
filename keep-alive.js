const axios = require('axios');

async function keepAlive() {
  const urls = [
    process.env.RENDER_EXTERNAL_URL || 'https://litewaydata.onrender.com',
    'https://litewaydata.onrender.com/health',
    'https://litewaydata.onrender.com/',
    'https://litewaydata.onrender.com/test'
  ];

  console.log('🔄 Starting keep-alive system...');
  
  setInterval(async () => {
    const now = new Date().toLocaleTimeString();
    
    for (const url of urls) {
      try {
        const response = await axios.get(url, { timeout: 10000 });
        console.log(`✅ ${now} - Keep-alive ping to ${url}: ${response.status}`);
        
        // Also ping Telegram API to keep bot active
        if (url.includes('render.com')) {
          try {
            await axios.get('https://api.telegram.org');
            console.log(`📡 ${now} - Telegram API ping successful`);
          } catch (tgError) {
            // Silent fail for Telegram ping
          }
        }
      } catch (error) {
        console.log(`⚠️ ${now} - Keep-alive failed for ${url}: ${error.message}`);
      }
    }
  }, 4 * 60 * 1000); // Every 4 minutes (under 15 min threshold)
  
  // Initial ping immediately
  try {
    await axios.get(urls[0]);
    console.log('🚀 Initial keep-alive ping successful');
  } catch (error) {
    console.log('⚠️ Initial keep-alive failed:', error.message);
  }
}

module.exports = keepAlive;