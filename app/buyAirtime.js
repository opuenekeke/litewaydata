// app/buyAirtime.js
const axios = require('axios');
const { Markup } = require('telegraf');

module.exports = {
  handleAirtime: async (ctx, users, sessions, CONFIG) => {
    try {
      const userId = ctx.from.id.toString();
      const user = users[userId] || {
        wallet: 0,
        kyc: 'pending',
        pin: null
      };
      
      if (user.kyc !== 'approved') {
        return await ctx.reply(
          '❌ *KYC VERIFICATION REQUIRED*\n\n' +
          '📝 Your account needs verification\\.\n\n' +
          '🛂 *To Get Verified\\:*\n' +
          'Contact @opuenekeke with your User ID',
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      if (!user.pin) {
        return await ctx.reply(
          '❌ *TRANSACTION PIN NOT SET*\n\n' +
          '🔐 Set PIN\\: `/setpin 1234`',
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      if (user.wallet <= CONFIG.MIN_AIRTIME) {
        return await ctx.reply(
          `❌ *INSUFFICIENT BALANCE*\n\n` +
          `💵 Your Balance\\: ${formatCurrency(user.wallet)}\n` +
          `💰 Minimum Airtime\\: ${formatCurrency(CONFIG.MIN_AIRTIME)}\n\n` +
          `💳 Use "💳 Deposit Funds" to add money`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      await ctx.reply(
        `📞 *BUY AIRTIME*\n\n` +
        `💵 *Your Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
        `📱 *Select Network\\:*`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🟢 MTN', 'airtime_mtn')],
            [Markup.button.callback('🔵 GLO', 'airtime_glo')],
            [Markup.button.callback('🔴 9MOBILE', 'airtime_9mobile')],
            [Markup.button.callback('🟡 AIRTEL', 'airtime_airtel')]
          ])
        }
      );
      
    } catch (error) {
      console.error('❌ Buy Airtime error:', error);
    }
  },

  getCallbacks: (bot, users, sessions, CONFIG, NETWORK_CODES) => {
    return {
      'airtime_mtn': async (ctx) => handleAirtimeNetwork(ctx, 'MTN', users, sessions, CONFIG),
      'airtime_glo': async (ctx) => handleAirtimeNetwork(ctx, 'GLO', users, sessions, CONFIG),
      'airtime_9mobile': async (ctx) => handleAirtimeNetwork(ctx, '9MOBILE', users, sessions, CONFIG),
      'airtime_airtel': async (ctx) => handleAirtimeNetwork(ctx, 'AIRTEL', users, sessions, CONFIG),
      'back_to_airtime_networks': async (ctx) => handleBackToNetworks(ctx, users, sessions, CONFIG)
    };
  },

  handleText: async (ctx, text, session, user, users, transactions, sessions, NETWORK_CODES, CONFIG) => {
    // AIRTIME: Amount entry
    if (session.action === 'airtime' && session.step === 1) {
      const amount = parseFloat(text);
      
      if (isNaN(amount) || amount < CONFIG.MIN_AIRTIME || amount > CONFIG.MAX_AIRTIME) {
        return await ctx.reply(
          `❌ *INVALID AMOUNT*\n\n` +
          `💰 Minimum\\: ${formatCurrency(CONFIG.MIN_AIRTIME)}\n` +
          `💎 Maximum\\: ${formatCurrency(CONFIG.MAX_AIRTIME)}\n\n` +
          `📝 Try again\\:`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      if (user.wallet < amount) {
        delete sessions[ctx.from.id.toString()];
        return await ctx.reply(
          `❌ *INSUFFICIENT BALANCE*\n\n` +
          `💵 Your Balance\\: ${formatCurrency(user.wallet)}\n` +
          `💰 Required\\: ${formatCurrency(amount)}`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      sessions[ctx.from.id.toString()].step = 2;
      sessions[ctx.from.id.toString()].amount = amount;
      
      await ctx.reply(
        `✅ *Amount Confirmed\\:* ${formatCurrency(amount)}\n\n` +
        `📱 *Network\\:* ${escapeMarkdown(session.network)}\n\n` +
        `📝 *Enter phone number\\:*\n\n` +
        `📱 *Format\\:* 08012345678 \\(must start with 0 and be 11 digits\\)`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    // AIRTIME: Phone entry
    else if (session.action === 'airtime' && session.step === 2) {
      const phone = text.replace(/\s+/g, '');
      
      if (!validatePhoneNumber(phone)) {
        return await ctx.reply(
          '❌ *INVALID PHONE NUMBER*\n\n' +
          '📱 *Valid Formats\\:*\n' +
          '• 08012345678 \\(preferred\\)\n' +
          '• 2348012345678\n' +
          '• \\+2348012345678\n\n' +
          '📝 Try again\\:',
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      sessions[ctx.from.id.toString()].step = 3;
      sessions[ctx.from.id.toString()].phone = phone;
      
      await ctx.reply(
        `📋 *AIRTIME ORDER SUMMARY*\n\n` +
        `📱 *Phone\\:* ${escapeMarkdown(formatPhoneNumberForVTU(phone))}\n` +
        `📶 *Network\\:* ${escapeMarkdown(session.network)}\n` +
        `💰 *Amount\\:* ${formatCurrency(session.amount)}\n\n` +
        `💳 *Your Balance\\:* ${formatCurrency(user.wallet)}\n` +
        `💵 *After Purchase\\:* ${formatCurrency(user.wallet - session.amount)}\n\n` +
        `🔐 *Enter your 4\\-digit PIN to confirm\\:*`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    // AIRTIME: PIN confirmation
    else if (session.action === 'airtime' && session.step === 3) {
      if (text !== user.pin) {
        user.pinAttempts++;
        
        if (user.pinAttempts >= 3) {
          user.pinLocked = true;
          delete sessions[ctx.from.id.toString()];
          return await ctx.reply(
            '❌ *ACCOUNT LOCKED*\n\n' +
            '🔒 Too many wrong PIN attempts\\.\n\n' +
            '📞 Contact admin to unlock\\.',
            { parse_mode: 'MarkdownV2' }
          );
        }
        
        return await ctx.reply(
          `❌ *WRONG PIN*\n\n` +
          `⚠️ Attempts left\\: ${3 - user.pinAttempts}\n\n` +
          `🔐 Enter correct PIN\\:`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      user.pinAttempts = 0;
      
      const { amount, phone, network } = session;
      const networkCode = NETWORK_CODES[network];
      const requestId = `AIR${Date.now()}_${ctx.from.id.toString()}`;
      
      const processingMsg = await ctx.reply(
        `🔄 *PROCESSING AIRTIME PURCHASE\\.\\.\\.*\n\n` +
        `⏳ Please wait while we connect to VTU service\\.\n` +
        `This may take up to 30 seconds\\.`,
        { parse_mode: 'MarkdownV2' }
      );
      
      try {
        console.log('📤 Processing airtime purchase for user:', ctx.from.id.toString());
        const apiResult = await buyAirtime(
          networkCode,
          phone,
          amount,
          requestId,
          CONFIG
        );
        
        console.log('📊 API Result:', apiResult);
        
        if (apiResult && (apiResult.Status === 'successful' || apiResult.status === 'success')) {
          user.wallet -= amount;
          
          transactions[ctx.from.id.toString()].push({
            type: 'airtime',
            amount: amount,
            network: network,
            phone: phone,
            reference: requestId,
            api_reference: apiResult.id || apiResult.ident || requestId,
            date: new Date().toLocaleString(),
            status: 'success',
            message: apiResult.api_response || 'Airtime purchase successful',
            api_response: apiResult,
            timestamp: Date.now()
          });
          
          const escapedPhone = escapeMarkdown(formatPhoneNumberForVTU(phone));
          const escapedNetwork = escapeMarkdown(network);
          
          await ctx.reply(
            `✅ *AIRTIME PURCHASE SUCCESSFUL\\!*\n\n` +
            `📱 *Phone\\:* ${escapedPhone}\n` +
            `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
            `📶 *Network\\:* ${escapedNetwork}\n` +
            `🔢 *Reference\\:* ${escapeMarkdown(requestId)}\n` +
            `💳 *New Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
            `🎉 *Status\\:* ✅ Successful\n\n` +
            `💡 *Note\\:* Airtime should arrive within 1\\-3 minutes\\.\n` +
            `If not received, contact admin with your reference\\!`,
            { parse_mode: 'MarkdownV2' }
          );
          
        } else {
          transactions[ctx.from.id.toString()].push({
            type: 'airtime',
            amount: amount,
            network: network,
            phone: phone,
            date: new Date().toLocaleString(),
            status: 'pending',
            reason: apiResult?.api_response || 'Transaction pending',
            timestamp: Date.now()
          });
          
          const escapedPhone = escapeMarkdown(formatPhoneNumberForVTU(phone));
          const escapedNetwork = escapeMarkdown(network);
          
          await ctx.reply(
            `⚠️ *AIRTIME PURCHASE PENDING*\n\n` +
            `📱 *Phone\\:* ${escapedPhone}\n` +
            `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
            `📶 *Network\\:* ${escapedNetwork}\n` +
            `🔢 *Reference\\:* ${escapeMarkdown(requestId)}\n\n` +
            `🔄 *Status\\:* Processing \\- Please wait 2\\-3 minutes\n\n` +
            `💡 *Note\\:* Your wallet has NOT been deducted\\.\n` +
            `If airtime is not received, contact admin\\.`,
            { parse_mode: 'MarkdownV2' }
          );
        }
      } catch (apiError) {
        console.error('❌ Airtime API Error Details:', {
          message: apiError.message,
          response: apiError.response?.data,
          status: apiError.response?.status
        });
        
        transactions[ctx.from.id.toString()].push({
          type: 'airtime',
          amount: amount,
          network: network,
          phone: phone,
          date: new Date().toLocaleString(),
          status: 'failed',
          reason: apiError.response?.data?.message || apiError.message || 'API connection failed',
          timestamp: Date.now()
        });
        
        const escapedPhone = escapeMarkdown(formatPhoneNumberForVTU(phone));
        const escapedNetwork = escapeMarkdown(network);
        
        await ctx.reply(
          `⚠️ *AIRTIME PURCHASE PENDING*\n\n` +
          `📱 *Phone\\:* ${escapedPhone}\n` +
          `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
          `📶 *Network\\:* ${escapedNetwork}\n` +
          `🔢 *Reference\\:* ${escapeMarkdown(requestId)}\n\n` +
          `🔄 *Status\\:* Processing \\- Please wait 2\\-3 minutes\n\n` +
          `💡 *Note\\:* Your wallet has NOT been deducted\\.\n` +
          `If airtime is not received, contact admin\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
      } catch (e) {}
      
      delete sessions[ctx.from.id.toString()];
    }
  }
};

// Helper functions
async function handleAirtimeNetwork(ctx, network, users, sessions, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    const user = users[userId] || { wallet: 0 };
    
    sessions[userId] = {
      action: 'airtime',
      step: 1,
      network: network,
      userId: userId
    };
    
    await ctx.editMessageText(
      `📞 *BUY AIRTIME \\- ${escapeMarkdown(network)}*\n\n` +
      `💵 *Your Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
      `💰 *Enter amount \\(${formatCurrency(CONFIG.MIN_AIRTIME)} \\- ${formatCurrency(CONFIG.MAX_AIRTIME)}\\)\\:*\n\n` +
      `📝 *Example\\:* 1000`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back to Networks', 'back_to_airtime_networks')]
        ])
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Airtime network selection error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleBackToNetworks(ctx, users, sessions, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    const user = users[userId] || { wallet: 0 };
    
    delete sessions[userId];
    
    await ctx.editMessageText(
      `📞 *BUY AIRTIME*\n\n` +
      `💵 *Your Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
      `📱 *Select Network\\:*`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🟢 MTN', 'airtime_mtn')],
          [Markup.button.callback('🔵 GLO', 'airtime_glo')],
          [Markup.button.callback('🔴 9MOBILE', 'airtime_9mobile')],
          [Markup.button.callback('🟡 AIRTEL', 'airtime_airtel')]
        ])
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Back to networks error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

async function buyAirtime(networkCode, phoneNumber, amount, requestId, CONFIG) {
  try {
    console.log('🔍 VTU API AIRTIME CALL:');
    const formattedPhone = formatPhoneNumberForAPI(phoneNumber);
    const payload = {
      network: networkCode,
      mobile_number: formattedPhone,
      Ported_number: "true",
      "request-id": requestId,
      amount: amount.toString(),
      airtime_type: "VTU"
    };
    
    const response = await axios.post(`${CONFIG.VTU_BASE_URL}/topup/`, payload, {
      headers: {
        'Authorization': `Token ${CONFIG.VTU_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ Airtime API Error:', error.message);
    throw error;
  }
}

function formatCurrency(amount) {
  return `₦${amount.toLocaleString('en-NG')}`;
}

function escapeMarkdown(text) {
  if (typeof text !== 'string') return text;
  const specialChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];
  let escapedText = text;
  specialChars.forEach(char => {
    const regex = new RegExp(`\\${char}`, 'g');
    escapedText = escapedText.replace(regex, `\\${char}`);
  });
  return escapedText;
}

function formatPhoneNumberForVTU(phone) {
  let cleaned = phone.replace(/\s+/g, '');
  if (cleaned.startsWith('+234')) {
    cleaned = '0' + cleaned.substring(4);
  } else if (cleaned.startsWith('234')) {
    cleaned = '0' + cleaned.substring(3);
  }
  if (!cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }
  if (cleaned.length > 11) {
    cleaned = cleaned.substring(0, 11);
  }
  return cleaned;
}

function formatPhoneNumberForAPI(phone) {
  let cleaned = phone.replace(/\s+/g, '');
  if (cleaned.startsWith('234')) {
    cleaned = '0' + cleaned.substring(3);
  }
  if (cleaned.startsWith('+234')) {
    cleaned = '0' + cleaned.substring(4);
  }
  if (!cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }
  if (cleaned.length !== 11) {
    if (cleaned.length > 11) {
      cleaned = cleaned.substring(0, 11);
    }
  }
  return cleaned;
}

function validatePhoneNumber(phone) {
  const cleaned = phone.replace(/\s+/g, '');
  return /^(0|234)(7|8|9)(0|1)\d{8}$/.test(cleaned);
}