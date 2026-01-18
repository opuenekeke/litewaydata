const axios = require('axios');

async function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || 'https://litewaydata.onrender.com';
  
  setInterval(async () => {
    try {
      const response = await axios.get(url);
      console.log(`✅ Keep-alive ping: ${response.status}`);
    } catch (error) {
      console.log(`⚠️ Keep-alive failed: ${error.message}`);
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

module.exports = keepAlive;