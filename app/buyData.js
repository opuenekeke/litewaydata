// app/buyData.js - FIXED CALLBACK PATTERNS
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Markup } = require('telegraf');

module.exports = {
  handleData: async (ctx, users, sessions, CONFIG) => {
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
      
      if (user.wallet < 100) {
        return await ctx.reply(
          `❌ *INSUFFICIENT BALANCE*\n\n` +
          `💵 Your Balance\\: ${formatCurrency(user.wallet)}\n` +
          `💰 Minimum Data Plan\\: ${formatCurrency(100)}\n\n` +
          `💳 Use "💳 Deposit Funds" to add money`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      const availableNetworks = getAvailableNetworks();
      
      if (availableNetworks.length === 0) {
        return await ctx.reply(
          '❌ *NO DATA PLANS AVAILABLE*\n\n' +
          'No data plans loaded\\. Please contact admin\\.',
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      const uniqueNetworks = [...new Set(availableNetworks)];
      const networkButtons = uniqueNetworks.map(network => [
        Markup.button.callback(`📱 ${network}`, `data_${network.toLowerCase().replace(/\s+/g, '_')}`)
      ]);
      
      networkButtons.push([Markup.button.callback('🏠 Home', 'start')]);
      
      await ctx.reply(
        `📡 *BUY DATA BUNDLE*\n\n` +
        `💵 *Your Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
        `📱 *Select Network\\:*`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard(networkButtons)
        }
      );
      
    } catch (error) {
      console.error('❌ Buy Data error:', error);
      await ctx.reply('❌ An error occurred. Please try again.');
    }
  },

  getCallbacks: (bot, users, sessions, CONFIG) => {
    return {
      'data_mtn': async (ctx) => handleDataNetwork(ctx, 'MTN', users, sessions, CONFIG),
      'data_glo': async (ctx) => handleDataNetwork(ctx, 'Glo', users, sessions, CONFIG),
      'data_airtel': async (ctx) => handleDataNetwork(ctx, 'AIRTEL', users, sessions, CONFIG),
      'data_9mobile': async (ctx) => handleDataNetwork(ctx, '9MOBILE', users, sessions, CONFIG),
      
      // FIXED: Use regex pattern to match validity callbacks
      '^validity_(.+)_(.+)$': async (ctx) => {
        console.log('📞 Validity callback triggered:', ctx.callbackQuery.data);
        const network = ctx.match[1];
        const validity = ctx.match[2];
        return handleValiditySelection(ctx, network, validity, users, sessions, CONFIG);
      },
      
      // FIXED: Use regex pattern to match plan callbacks
      '^plan_(.+)_(.+)_(.+)$': async (ctx) => {
        console.log('📞 Plan callback triggered:', ctx.callbackQuery.data);
        const network = ctx.match[1];
        const validity = ctx.match[2];
        const planId = ctx.match[3];
        return handlePlanSelection(ctx, network, validity, planId, users, sessions, CONFIG);
      },
      
      'back_to_data_networks': async (ctx) => handleBackToDataNetworks(ctx, users, sessions, CONFIG),
    };
  },

  handleText: async (ctx, text, session, user, users, transactions, sessions, NETWORK_CODES, CONFIG) => {
    const userId = ctx.from.id.toString();
    
    // DATA: Phone entry
    if (session.action === 'data' && session.step === 2) {
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
      
      sessions[userId].step = 3;
      sessions[userId].phone = phone;
      
      const { selectedPlan, amount } = session;
      
      await ctx.reply(
        `📋 *DATA ORDER SUMMARY*\n\n` +
        `📱 *Phone\\:* ${escapeMarkdown(formatPhoneNumberForVTU(phone))}\n` +
        `📶 *Network\\:* ${escapeMarkdown(selectedPlan.Network)}\n` +
        `📊 *Plan\\:* ${escapeMarkdown(selectedPlan.Plan)}\n` +
        `📅 *Validity\\:* ${escapeMarkdown(selectedPlan.Validity)}\n` +
        `💰 *Price\\:* ${formatCurrency(amount)}\n\n` +
        `💳 *Your Balance\\:* ${formatCurrency(user.wallet)}\n` +
        `💵 *After Purchase\\:* ${formatCurrency(user.wallet - amount)}\n\n` +
        `🔐 *Enter your 4\\-digit PIN to confirm\\:*`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    // DATA: PIN confirmation
    else if (session.action === 'data' && session.step === 3) {
      if (text !== user.pin) {
        user.pinAttempts = (user.pinAttempts || 0) + 1;
        
        if (user.pinAttempts >= 3) {
          user.pinLocked = true;
          delete sessions[userId];
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
      
      const { selectedPlan, amount, phone } = session;
      const networkCode = NETWORK_CODES[selectedPlan.Network.toUpperCase()] || '2';
      const requestId = `DATA${Date.now()}_${userId}`;
      
      const processingMsg = await ctx.reply(
        `🔄 *PROCESSING DATA PURCHASE\\.\\.\\.*\n\n` +
        `⏳ Please wait while we connect to VTU service\\.\n` +
        `This may take up to 30 seconds\\.`,
        { parse_mode: 'MarkdownV2' }
      );
      
      try {
        console.log('📤 Processing data purchase for user:', userId);
        const apiResult = await buyData(
          networkCode,
          phone,
          selectedPlan.PlanID,
          requestId,
          CONFIG
        );
        
        console.log('📊 API Result:', apiResult);
        
        if (apiResult && (apiResult.Status === 'successful' || apiResult.status === 'success')) {
          user.wallet -= amount;
          
          if (!transactions[userId]) {
            transactions[userId] = [];
          }
          
          transactions[userId].push({
            type: 'data',
            amount: amount,
            network: selectedPlan.Network,
            plan: selectedPlan.Plan,
            validity: selectedPlan.Validity,
            phone: phone,
            reference: requestId,
            api_reference: apiResult.id || apiResult.ident || requestId,
            date: new Date().toLocaleString(),
            status: 'success',
            message: apiResult.api_response || 'Data purchase successful',
            api_response: apiResult,
            timestamp: Date.now()
          });
          
          const escapedPhone = escapeMarkdown(formatPhoneNumberForVTU(phone));
          const escapedNetwork = escapeMarkdown(selectedPlan.Network);
          const escapedPlan = escapeMarkdown(selectedPlan.Plan);
          const escapedValidity = escapeMarkdown(selectedPlan.Validity);
          
          await ctx.reply(
            `✅ *DATA PURCHASE SUCCESSFUL\\!*\n\n` +
            `📱 *Phone\\:* ${escapedPhone}\n` +
            `📶 *Network\\:* ${escapedNetwork}\n` +
            `📊 *Plan\\:* ${escapedPlan}\n` +
            `📅 *Validity\\:* ${escapedValidity}\n` +
            `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
            `🔢 *Reference\\:* ${escapeMarkdown(requestId)}\n` +
            `💳 *New Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
            `🎉 *Status\\:* ✅ Successful\n\n` +
            `💡 *Note\\:* Data should arrive within 1\\-3 minutes\\.\n` +
            `If not received, contact admin with your reference\\!`,
            { parse_mode: 'MarkdownV2' }
          );
          
        } else {
          if (!transactions[userId]) {
            transactions[userId] = [];
          }
          
          transactions[userId].push({
            type: 'data',
            amount: amount,
            network: selectedPlan.Network,
            plan: selectedPlan.Plan,
            phone: phone,
            date: new Date().toLocaleString(),
            status: 'pending',
            reason: apiResult?.api_response || 'Transaction pending',
            timestamp: Date.now()
          });
          
          const escapedPhone = escapeMarkdown(formatPhoneNumberForVTU(phone));
          const escapedNetwork = escapeMarkdown(selectedPlan.Network);
          const escapedPlan = escapeMarkdown(selectedPlan.Plan);
          
          await ctx.reply(
            `⚠️ *DATA PURCHASE PENDING*\n\n` +
            `📱 *Phone\\:* ${escapedPhone}\n` +
            `📶 *Network\\:* ${escapedNetwork}\n` +
            `📊 *Plan\\:* ${escapedPlan}\n` +
            `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
            `🔢 *Reference\\:* ${escapeMarkdown(requestId)}\n\n` +
            `🔄 *Status\\:* Processing \\- Please wait 2\\-3 minutes\n\n` +
            `💡 *Note\\:* Your wallet has NOT been deducted\\.\n` +
            `If data is not received, contact admin\\.`,
            { parse_mode: 'MarkdownV2' }
          );
        }
      } catch (apiError) {
        console.error('❌ Data API Error Details:', apiError.message);
        
        if (!transactions[userId]) {
          transactions[userId] = [];
        }
        
        transactions[userId].push({
          type: 'data',
          amount: amount,
          network: selectedPlan.Network,
          plan: selectedPlan.Plan,
          phone: phone,
          date: new Date().toLocaleString(),
          status: 'failed',
          reason: apiError.response?.data?.message || apiError.message || 'API connection failed',
          timestamp: Date.now()
        });
        
        const escapedPhone = escapeMarkdown(formatPhoneNumberForVTU(phone));
        const escapedNetwork = escapeMarkdown(selectedPlan.Network);
        const escapedPlan = escapeMarkdown(selectedPlan.Plan);
        
        await ctx.reply(
          `⚠️ *DATA PURCHASE PENDING*\n\n` +
          `📱 *Phone\\:* ${escapedPhone}\n` +
          `📶 *Network\\:* ${escapedNetwork}\n` +
          `📊 *Plan\\:* ${escapedPlan}\n` +
          `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
          `🔢 *Reference\\:* ${escapeMarkdown(requestId)}\n\n` +
          `🔄 *Status\\:* Processing \\- Please wait 2\\-3 minutes\n\n` +
          `💡 *Note\\:* Your wallet has NOT been deducted\\.\n` +
          `If data is not received, contact admin\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
      } catch (e) {
        console.error('Error deleting processing message:', e);
      }
      
      delete sessions[userId];
    }
  }
};

// Helper functions (keep the same as before, but with one crucial fix in handleValiditySelection)
async function handleDataNetwork(ctx, network, users, sessions, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    const user = users[userId] || { wallet: 0 };
    
    const validities = getAvailableValidities(network);
    
    console.log(`📅 Validities for ${network}:`, validities);
    
    if (validities.length === 0) {
      await ctx.editMessageText(
        `❌ *NO DATA PLANS AVAILABLE*\n\n` +
        `No data plans found for ${escapeMarkdown(network)}\\.\n` +
        `Please try another network\\.`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back to Networks', 'back_to_data_networks')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        }
      );
      return ctx.answerCbQuery();
    }
    
    sessions[userId] = {
      action: 'data',
      step: 1,
      network: network,
      userId: userId
    };
    
    const validityButtons = validities.map(validity => [
      Markup.button.callback(
        `📅 ${validity}`,
        `validity_${network}_${validity.toLowerCase().replace(/\s+/g, '_')}`
      )
    ]);
    
    validityButtons.push([
      Markup.button.callback('⬅️ Back to Networks', 'back_to_data_networks')
    ]);
    
    await ctx.editMessageText(
      `📡 *BUY DATA \\- ${escapeMarkdown(network)}*\n\n` +
      `💵 *Your Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
      `📅 *Select Validity Type\\:*`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(validityButtons)
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Data network selection error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleValiditySelection(ctx, network, validityType, users, sessions, CONFIG) {
  try {
    console.log(`📞 Validity selection: ${network} - ${validityType}`);
    const userId = ctx.from.id.toString();
    const user = users[userId] || { wallet: 0 };
    
    // CRUCIAL: Update session
    sessions[userId] = {
      action: 'data',
      step: 1,
      network: network,
      validityType: validityType,
      userId: userId
    };
    
    // Convert validityType to proper case (daily -> Daily)
    const formattedValidity = validityType.charAt(0).toUpperCase() + validityType.slice(1);
    
    const dataPlans = getDataPlans(network, formattedValidity, CONFIG);
    
    console.log(`📊 Loading ${network} ${formattedValidity} plans...`);
    console.log(`📁 Found ${dataPlans.length} plans`);
    
    if (dataPlans.length === 0) {
      await ctx.editMessageText(
        `❌ *NO ${escapeMarkdown(formattedValidity.toUpperCase())} PLANS AVAILABLE*\n\n` +
        `No ${escapeMarkdown(formattedValidity)} plans found for ${escapeMarkdown(network)}\\.\n` +
        `Please try another validity type\\.`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', `data_${network.toLowerCase().replace(/\s+/g, '_')}`)]
          ])
        }
      );
      return ctx.answerCbQuery();
    }
    
    // Create plan buttons
    const planButtons = [];
    
    for (let i = 0; i < dataPlans.length; i += 2) {
      const row = [];
      for (let j = 0; j < 2 && (i + j) < dataPlans.length; j++) {
        const plan = dataPlans[i + j];
        // Truncate long plan names
        const planName = plan.Plan.length > 20 ? plan.Plan.substring(0, 20) + '...' : plan.Plan;
        const buttonText = `${planName} - ${formatCurrency(plan.DisplayPrice)}`;
        row.push(
          Markup.button.callback(
            buttonText,
            `plan_${network}_${validityType.toLowerCase()}_${plan.PlanID.toString().replace(/[^a-zA-Z0-9]/g, '_')}`
          )
        );
      }
      planButtons.push(row);
    }
    
    // Add back button
    planButtons.push([
      Markup.button.callback('⬅️ Back', `data_${network.toLowerCase().replace(/\s+/g, '_')}`)
    ]);
    
    await ctx.editMessageText(
      `📡 *BUY DATA \\- ${escapeMarkdown(network)} ${escapeMarkdown(formattedValidity)}*\n\n` +
      `💵 *Your Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
      `📊 *Select Data Plan\\:*\n` +
      `💡 Price includes ${formatCurrency(CONFIG.SERVICE_FEE)} service fee`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(planButtons)
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Data validity selection error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handlePlanSelection(ctx, network, validityType, planId, users, sessions, CONFIG) {
  try {
    console.log(`📞 Plan selection: ${network} - ${validityType} - ${planId}`);
    const userId = ctx.from.id.toString();
    const user = users[userId] || { wallet: 0 };
    
    // Convert validityType to proper case
    const formattedValidity = validityType.charAt(0).toUpperCase() + validityType.slice(1);
    
    // Replace underscores with original characters
    const originalPlanId = planId.replace(/_/g, ' ');
    
    const dataPlans = getDataPlans(network, formattedValidity, CONFIG);
    const selectedPlan = dataPlans.find(plan => 
      plan.PlanID.toString().replace(/[^a-zA-Z0-9]/g, '_') === planId || 
      plan.PlanID.toString() === originalPlanId
    );
    
    if (!selectedPlan) {
      console.log(`❌ Plan not found: ${planId}`);
      await ctx.editMessageText(
        '❌ *PLAN NOT FOUND*\n\n' +
        'The selected plan is no longer available\\.\n' +
        'Please select another plan\\.',
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', `validity_${network}_${validityType.toLowerCase()}`)]
          ])
        }
      );
      return ctx.answerCbQuery();
    }
    
    const totalPrice = selectedPlan.DisplayPrice;
    
    if (user.wallet < totalPrice) {
      await ctx.editMessageText(
        `❌ *INSUFFICIENT BALANCE*\n\n` +
        `💵 Your Balance\\: ${formatCurrency(user.wallet)}\n` +
        `💰 Required\\: ${formatCurrency(totalPrice)}\n\n` +
        `💳 Deposit funds and try again\\.`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⬅️ Back', `validity_${network}_${validityType.toLowerCase()}`)]
          ])
        }
      );
      return ctx.answerCbQuery();
    }
    
    // Update session
    sessions[userId] = {
      action: 'data',
      step: 2,
      network: network,
      validityType: formattedValidity,
      planId: selectedPlan.PlanID,
      selectedPlan: selectedPlan,
      amount: totalPrice,
      userId: userId
    };
    
    await ctx.editMessageText(
      `✅ *Plan Selected\\:* ${escapeMarkdown(selectedPlan.Plan)}\n\n` +
      `📊 *Plan Details\\:*\n` +
      `📱 Network\\: ${escapeMarkdown(selectedPlan.Network)}\n` +
      `📅 Validity\\: ${escapeMarkdown(selectedPlan.Validity)}\n` +
      `💰 Price\\: ${formatCurrency(totalPrice)}\n\n` +
      `📝 *Enter phone number\\:*\n\n` +
      `📱 *Format\\:* 08012345678 \\(must start with 0 and be 11 digits\\)`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('⬅️ Back', `validity_${network}_${validityType.toLowerCase()}`)]
        ])
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Data plan selection error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

async function handleBackToDataNetworks(ctx, users, sessions, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    const user = users[userId] || { wallet: 0 };
    
    delete sessions[userId];
    
    const availableNetworks = getAvailableNetworks();
    const uniqueNetworks = [...new Set(availableNetworks)];
    
    if (uniqueNetworks.length === 0) {
      await ctx.editMessageText(
        '❌ *NO DATA PLANS AVAILABLE*\n\n' +
        'No data plans loaded\\. Please contact admin\\.',
        { parse_mode: 'MarkdownV2' }
      );
      return ctx.answerCbQuery();
    }
    
    const networkButtons = uniqueNetworks.map(network => [
      Markup.button.callback(`📱 ${network}`, `data_${network.toLowerCase().replace(/\s+/g, '_')}`)
    ]);
    
    networkButtons.push([Markup.button.callback('🏠 Home', 'start')]);
    
    await ctx.editMessageText(
      `📡 *BUY DATA BUNDLE*\n\n` +
      `💵 *Your Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
      `📱 *Select Network\\:*`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(networkButtons)
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Back to data networks error:', error);
    ctx.answerCbQuery('❌ Error occurred');
  }
}

// Keep all other helper functions exactly the same as in my previous response:
// buyData(), getAvailableNetworks(), getAvailableValidities(), getDataPlans(),
// formatCurrency(), escapeMarkdown(), formatPhoneNumberForVTU(),
// formatPhoneNumberForAPI(), validatePhoneNumber()
// ... (they should remain unchanged from the previous complete code)

async function buyData(networkCode, phoneNumber, planId, requestId, CONFIG) {
  try {
    const formattedPhone = formatPhoneNumberForAPI(phoneNumber);
    const payload = {
      network: networkCode,
      mobile_number: formattedPhone,
      Ported_number: "true",
      "request-id": requestId,
      plan: planId.toString()
    };
    
    console.log('📤 Data API Payload:', payload);
    
    const response = await axios.post(`${CONFIG.VTU_BASE_URL}/data/`, payload, {
      headers: {
        'Authorization': `Token ${CONFIG.VTU_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ Data API Error:', error.message);
    throw error;
  }
}

function getAvailableNetworks() {
  try {
    const networks = [];
    const basePath = process.cwd();
    
    if (fs.existsSync(path.join(basePath, 'MTN'))) networks.push('MTN');
    if (fs.existsSync(path.join(basePath, 'Glo'))) networks.push('Glo');
    if (fs.existsSync(path.join(basePath, 'GLO'))) networks.push('Glo');
    if (fs.existsSync(path.join(basePath, 'AIRTEL'))) networks.push('AIRTEL');
    if (fs.existsSync(path.join(basePath, '9MOBILE'))) networks.push('9MOBILE');
    
    console.log(`📱 Found networks: ${networks.join(', ')}`);
    return networks;
  } catch (error) {
    console.error('Error getting networks:', error);
    return ['MTN', 'Glo', 'AIRTEL', '9MOBILE'];
  }
}

function getAvailableValidities(network) {
  try {
    const validities = [];
    let networkFolder = network;
    
    if (network === 'Glo') {
      if (fs.existsSync(path.join(process.cwd(), 'Glo'))) {
        networkFolder = 'Glo';
      } else if (fs.existsSync(path.join(process.cwd(), 'GLO'))) {
        networkFolder = 'GLO';
      }
    }
    
    const basePath = process.cwd();
    const networkPath = path.join(basePath, networkFolder);
    
    console.log(`📁 Checking network path: ${networkPath}`);
    
    if (!fs.existsSync(networkPath)) {
      console.log(`❌ Network folder not found: ${networkPath}`);
      return ['Monthly'];
    }
    
    const files = fs.readdirSync(networkPath);
    console.log(`📄 Files in ${networkFolder}:`, files);
    
    const validityFiles = {
      'daily.json': 'Daily',
      'weekly.json': 'Weekly',
      'monthly.json': 'Monthly'
    };
    
    for (const [file, validity] of Object.entries(validityFiles)) {
      if (files.includes(file)) {
        validities.push(validity);
      }
    }
    
    console.log(`📅 Validities for ${network}: ${validities.join(', ')}`);
    return validities.length > 0 ? validities : ['Monthly'];
  } catch (error) {
    console.error(`Error getting validities for ${network}:`, error);
    return ['Monthly'];
  }
}

function getDataPlans(network, validityType = null, CONFIG) {
  try {
    let networkFolder = network;
    
    if (network === 'Glo') {
      if (fs.existsSync(path.join(process.cwd(), 'Glo'))) {
        networkFolder = 'Glo';
      } else if (fs.existsSync(path.join(process.cwd(), 'GLO'))) {
        networkFolder = 'GLO';
      }
    }
    
    const basePath = process.cwd();
    
    if (validityType) {
      const fileName = validityType.toLowerCase() + '.json';
      const filePath = path.join(basePath, networkFolder, fileName);
      
      console.log(`📂 Looking for data plans at: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        console.log(`❌ Data plan file not found: ${filePath}`);
        return [];
      }
      
      try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        console.log(`📄 File content length: ${fileContent.length} characters`);
        
        let plans;
        try {
          plans = JSON.parse(fileContent);
        } catch (parseError) {
          console.error(`❌ JSON parse error: ${parseError.message}`);
          return [];
        }
        
        let planArray = [];
        
        if (Array.isArray(plans)) {
          planArray = plans;
        } else if (plans && typeof plans === 'object') {
          if (plans.data && Array.isArray(plans.data)) {
            planArray = plans.data;
          } else if (plans.plans && Array.isArray(plans.plans)) {
            planArray = plans.plans;
          } else if (plans.products && Array.isArray(plans.products)) {
            planArray = plans.products;
          } else {
            for (const key in plans) {
              if (Array.isArray(plans[key])) {
                planArray = plans[key];
                break;
              }
            }
          }
        }
        
        console.log(`✅ Parsed ${planArray.length} ${network} ${validityType} plans`);
        
        if (planArray.length === 0) {
          console.log(`⚠️ No plans found in the parsed data`);
          return [];
        }
        
        const formattedPlans = planArray.map((plan, index) => {
          const planName = plan.data || plan.Plan || plan.name || 
                          plan.description || plan.product_name || 
                          plan.plan_name || `Plan ${index + 1}`;
          
          const planPrice = parseFloat(plan.price || plan.Price || 
                                      plan.amount || plan.product_amount || 
                                      plan.plan_price || 0);
          
          const planId = (plan.id || plan.PlanID || plan.plan_id || 
                         plan.product_id || plan.code || 
                         (index + 1).toString()).toString();
          
          const planValidity = plan.validity || plan.Validity || 
                              plan.duration || validityType;
          
          return {
            Network: network,
            Plan: planName,
            Validity: planValidity,
            Price: planPrice,
            PlanID: planId,
            DisplayPrice: planPrice + CONFIG.SERVICE_FEE
          };
        });
        
        formattedPlans.sort((a, b) => a.Price - b.Price);
        
        return formattedPlans;
      } catch (parseError) {
        console.error(`❌ Error processing ${filePath}:`, parseError);
        return [];
      }
    }
    
    console.log(`⚠️ No validity type specified for ${network}`);
    return [];
  } catch (error) {
    console.error(`❌ Error loading ${network} ${validityType} plans:`, error.message);
    return [];
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
  return /^(0|234|\+234)(7|8|9)(0|1)\d{8}$/.test(cleaned);
}