// app/sendmoney.js
const axios = require('axios');
const { Markup } = require('telegraf');

// Configuration
const CONFIG = {
  MONNIFY_API_KEY: process.env.MONNIFY_API_KEY,
  MONNIFY_SECRET_KEY: process.env.MONNIFY_SECRET_KEY,
  MONNIFY_CONTRACT_CODE: process.env.MONNIFY_CONTRACT_CODE,
  MONNIFY_BASE_URL: process.env.MONNIFY_BASE_URL || 'https://api.monnify.com',
  MONNIFY_SOURCE_ACCOUNT: process.env.MONNIFY_SOURCE_ACCOUNT,
  MONNIFY_SOURCE_NAME: process.env.MONNIFY_SOURCE_NAME,
  MONNIFY_SOURCE_BVN: process.env.MONNIFY_SOURCE_BVN || '00000000000',
  MONNIFY_SOURCE_BANK_CODE: process.env.MONNIFY_SOURCE_BANK_CODE,
  TRANSFER_FEE_PERCENTAGE: 1.5,
  MIN_TRANSFER_AMOUNT: 100,
  MAX_TRANSFER_AMOUNT: 1000000
};

// Global sessions object that will be shared
const sendMoneySessions = {};

// Session management 
const sessionManager = {
  startSession: (userId, action) => {
    sendMoneySessions[userId] = {
      action: action,
      step: 1,
      data: {},
      timestamp: Date.now()
    };
    console.log(`💼 SendMoney: Session started for ${userId}: ${action}`);
    return sendMoneySessions[userId];
  },
  
  getSession: (userId) => {
    return sendMoneySessions[userId] || null;
  },
  
  updateStep: (userId, step, data = {}) => {
    if (sendMoneySessions[userId]) {
      sendMoneySessions[userId].step = step;
      if (data) {
        Object.assign(sendMoneySessions[userId].data, data);
      }
      console.log(`💼 SendMoney: User ${userId} updated to step ${step}, data:`, data);
    }
  },
  
  clearSession: (userId) => {
    delete sendMoneySessions[userId];
    console.log(`💼 SendMoney: Session cleared for ${userId}`);
  },
  
  updateSession: (userId, updates) => {
    if (sendMoneySessions[userId]) {
      Object.assign(sendMoneySessions[userId], updates);
    }
  }
};

// Helper Functions
async function getMonnifyToken() {
  try {
    const authString = Buffer.from(`${CONFIG.MONNIFY_API_KEY}:${CONFIG.MONNIFY_SECRET_KEY}`).toString('base64');
    
    const response = await axios.post(
      `${CONFIG.MONNIFY_BASE_URL}/api/v1/auth/login`,
      {},
      {
        headers: {
          'Authorization': `Basic ${authString}`
        }
      }
    );
    
    console.log('🔑 Monnify token obtained');
    return response.data.responseBody.accessToken;
  } catch (error) {
    console.error('❌ Monnify auth error:', error.response?.data || error.message);
    throw new Error('Failed to authenticate with Monnify');
  }
}

async function resolveBankAccount(accountNumber, bankCode) {
  try {
    const token = await getMonnifyToken();
    
    const response = await axios.get(
      `${CONFIG.MONNIFY_BASE_URL}/api/v1/disbursements/account/validate`,
      {
        params: {
          accountNumber: accountNumber,
          bankCode: bankCode
        },
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    console.log('💼 SendMoney: Monnify account resolution response:', response.data);
    
    if (response.data && response.data.responseBody) {
      const responseBody = response.data.responseBody;
      
      // Fixed: Handle cases where values might be undefined or "undefined"
      return {
        success: true,
        accountName: responseBody.accountName && responseBody.accountName !== 'undefined' && responseBody.accountName !== 'null' 
          ? responseBody.accountName 
          : 'Account Holder Name',
        accountNumber: responseBody.accountNumber && responseBody.accountNumber !== 'undefined' 
          ? responseBody.accountNumber 
          : accountNumber,
        bankCode: responseBody.bankCode && responseBody.bankCode !== 'undefined' 
          ? responseBody.bankCode 
          : bankCode,
        bankName: responseBody.bankName && responseBody.bankName !== 'undefined' && responseBody.bankName !== 'null'
          ? responseBody.bankName 
          : 'Selected Bank'
      };
    } else {
      return {
        success: false,
        error: 'Invalid response from bank'
      };
    }
  } catch (error) {
    console.error('❌ Account resolution error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.responseMessage || 'Failed to resolve account'
    };
  }
}

async function getBanks() {
  try {
    const token = await getMonnifyToken();
    
    const response = await axios.get(
      `${CONFIG.MONNIFY_BASE_URL}/api/v1/banks`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    return response.data.responseBody;
  } catch (error) {
    console.error('❌ Get banks error:', error.response?.data || error.message);
    // Fallback bank list
    return [
      { code: "044", name: "Access Bank" },
      { code: "063", name: "Access Bank (Diamond)" },
      { code: "050", name: "Ecobank Nigeria" },
      { code: "070", name: "Fidelity Bank" },
      { code: "011", name: "First Bank of Nigeria" },
      { code: "214", name: "First City Monument Bank" },
      { code: "058", name: "Guaranty Trust Bank" },
      { code: "030", name: "Heritage Bank" },
      { code: "301", name: "Jaiz Bank" },
      { code: "082", name: "Keystone Bank" },
      { code: "076", name: "Polaris Bank" },
      { code: "101", name: "Providus Bank" },
      { code: "221", name: "Stanbic IBTC Bank" },
      { code: "068", name: "Standard Chartered Bank" },
      { code: "232", name: "Sterling Bank" },
      { code: "100", name: "Suntrust Bank" },
      { code: "032", name: "Union Bank of Nigeria" },
      { code: "033", name: "United Bank for Africa" },
      { code: "215", name: "Unity Bank" },
      { code: "035", name: "Wema Bank" },
      { code: "057", name: "Zenith Bank" }
    ];
  }
}

async function initiateTransfer(transferData) {
  try {
    const token = await getMonnifyToken();
    
    // Prepare sender info
    const senderInfo = {
      sourceAccountNumber: CONFIG.MONNIFY_SOURCE_ACCOUNT,
      sourceAccountName: CONFIG.MONNIFY_SOURCE_NAME,
      sourceAccountBvn: CONFIG.MONNIFY_SOURCE_BVN,
      senderBankCode: CONFIG.MONNIFY_SOURCE_BANK_CODE
    };
    
    // Prepare payload according to Monnify v2 API
    const payload = {
      amount: transferData.amount,
      reference: transferData.reference,
      narration: transferData.narration || `Transfer to ${transferData.accountName}`,
      destinationBankCode: transferData.bankCode,
      destinationAccountNumber: transferData.accountNumber,
      destinationAccountName: transferData.accountName,
      currency: "NGN",
      sourceAccountNumber: CONFIG.MONNIFY_SOURCE_ACCOUNT,
      async: true, // Use async to avoid waiting for OTP
      senderInfo: senderInfo
    };
    
    console.log('💼 SendMoney: Monnify transfer payload:', JSON.stringify(payload, null, 2));
    
    // Use v2 API endpoint for transfers
    const response = await axios.post(
      `${CONFIG.MONNIFY_BASE_URL}/api/v2/disbursements/single`,
      payload,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('💼 SendMoney: Monnify transfer response:', JSON.stringify(response.data, null, 2));
    
    if (response.data.responseBody && response.data.responseBody.transactionReference) {
      return {
        success: true,
        transactionReference: response.data.responseBody.transactionReference,
        paymentReference: response.data.responseBody.paymentReference,
        amount: response.data.responseBody.amount,
        status: response.data.responseBody.status,
        requiresOTP: response.data.responseBody.authorizationRequired || false,
        message: response.data.responseMessage
      };
    } else {
      return {
        success: false,
        error: response.data.responseMessage || 'Transfer initiation failed'
      };
    }
    
  } catch (error) {
    console.error('❌ Transfer initiation error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.responseMessage || 'Transfer failed',
      fullError: error.response?.data
    };
  }
}

async function validateTransferOTP(reference, authorizationCode) {
  try {
    const token = await getMonnifyToken();
    
    const response = await axios.post(
      `${CONFIG.MONNIFY_BASE_URL}/api/v2/disbursements/single/validate-otp`,
      {
        reference: reference,
        authorizationCode: authorizationCode
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return {
      success: true,
      status: response.data.responseBody?.status,
      message: response.data.responseMessage
    };
    
  } catch (error) {
    console.error('❌ OTP validation error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.responseMessage || 'OTP validation failed'
    };
  }
}

async function checkTransferStatus(transactionReference) {
  try {
    const token = await getMonnifyToken();
    
    const response = await axios.get(
      `${CONFIG.MONNIFY_BASE_URL}/api/v2/disbursements/single/transactions/${transactionReference}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    return {
      success: true,
      status: response.data.responseBody?.status,
      transaction: response.data.responseBody
    };
    
  } catch (error) {
    console.error('❌ Transfer status check error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.responseMessage || 'Failed to check status'
    };
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

function isMonnifyConfigured() {
  return CONFIG.MONNIFY_API_KEY && 
         CONFIG.MONNIFY_SECRET_KEY && 
         CONFIG.MONNIFY_CONTRACT_CODE &&
         CONFIG.MONNIFY_SOURCE_ACCOUNT &&
         CONFIG.MONNIFY_SOURCE_NAME &&
         CONFIG.MONNIFY_SOURCE_BANK_CODE;
}

// Main handler
async function handleSendMoney(ctx, users, transactions) {
  try {
    const userId = ctx.from.id.toString();
    
    // Check KYC
    const user = users[userId];
    if (!user) {
      return await ctx.reply(
        '❌ User not found. Please use /start first.',
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    if (user.kycStatus !== 'approved') {
      return await ctx.reply(
        '❌ *KYC VERIFICATION REQUIRED*\n\n' +
        '📝 Your account needs verification\\.\n\n' +
        '🛂 *To Get Verified\\:*\n' +
        'Contact @opuenekeke with your User ID',
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    // Check PIN
    if (!user.pin) {
      return await ctx.reply(
        '❌ *TRANSACTION PIN NOT SET*\n\n' +
        '🔐 Set PIN\\: `/setpin 1234`',
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    // Check Monnify configuration
    if (!isMonnifyConfigured()) {
      console.error('❌ Monnify not configured properly');
      return await ctx.reply(
        '❌ *BANK TRANSFER SERVICE UNAVAILABLE*\n\n' +
        'Bank transfers are currently disabled\\.\n\n' +
        '📞 Contact admin for assistance\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    // Check balance
    if (user.wallet < CONFIG.MIN_TRANSFER_AMOUNT) {
      return await ctx.reply(
        `❌ *INSUFFICIENT BALANCE*\n\n` +
        `💵 Your Balance\\: ${formatCurrency(user.wallet)}\n` +
        `💰 Minimum Transfer\\: ${formatCurrency(CONFIG.MIN_TRANSFER_AMOUNT)}\n\n` +
        `💳 Use "💳 Deposit Funds" to add money`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    // Start session
    sessionManager.startSession(userId, 'send_money');
    
    // Get banks and show selection
    const banks = await getBanks();
    
    // Create bank buttons
    const bankButtons = [];
    const banksPerRow = 2;
    
    for (let i = 0; i < banks.length; i += banksPerRow) {
      const row = [];
      for (let j = 0; j < banksPerRow && i + j < banks.length; j++) {
        const bank = banks[i + j];
        row.push(Markup.button.callback(`🏦 ${bank.name}`, `sendmoney_bank_${bank.code}`));
      }
      bankButtons.push(row);
    }
    
    bankButtons.push([
      Markup.button.callback('🔄 Refresh Banks', 'sendmoney_refresh_banks'),
      Markup.button.callback('⬅️ Cancel', 'start')
    ]);
    
    await ctx.reply(
      `🏦 *TRANSFER TO BANK ACCOUNT*\n\n` +
      `💵 *Your Balance\\:* ${formatCurrency(user.wallet)}\n` +
      `💸 *Transfer Fee\\:* ${CONFIG.TRANSFER_FEE_PERCENTAGE}%\n` +
      `💰 *Min\\:* ${formatCurrency(CONFIG.MIN_TRANSFER_AMOUNT)} \\| *Max\\:* ${formatCurrency(CONFIG.MAX_TRANSFER_AMOUNT)}\n\n` +
      `📋 *Select Bank\\:*`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard(bankButtons)
      }
    );
    
  } catch (error) {
    console.error('❌ Send money handler error:', error);
    await ctx.reply(
      '❌ *TRANSFER ERROR*\n\n' +
      'Failed to initialize transfer\\. Please try again\\.',
      { parse_mode: 'MarkdownV2' }
    );
  }
}

// Handle callback queries
function getCallbacks(bot, users, transactions, CONFIG) {
  return {
    // Refresh banks list
    'sendmoney_refresh_banks': async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        
        const banks = await getBanks();
        const bankButtons = [];
        const banksPerRow = 2;
        
        for (let i = 0; i < banks.length; i += banksPerRow) {
          const row = [];
          for (let j = 0; j < banksPerRow && i + j < banks.length; j++) {
            const bank = banks[i + j];
            row.push(Markup.button.callback(`🏦 ${bank.name}`, `sendmoney_bank_${bank.code}`));
          }
          bankButtons.push(row);
        }
        
        bankButtons.push([
          Markup.button.callback('🔄 Refresh Banks', 'sendmoney_refresh_banks'),
          Markup.button.callback('⬅️ Cancel', 'start')
        ]);
        
        await ctx.editMessageText(
          `🏦 *TRANSFER TO BANK ACCOUNT*\n\n` +
          `💵 *Your Balance\\:* ${formatCurrency(users[userId]?.wallet || 0)}\n` +
          `💸 *Transfer Fee\\:* ${CONFIG.TRANSFER_FEE_PERCENTAGE}%\n` +
          `💰 *Min\\:* ${formatCurrency(CONFIG.MIN_TRANSFER_AMOUNT)} \\| *Max\\:* ${formatCurrency(CONFIG.MAX_TRANSFER_AMOUNT)}\n\n` +
          `📋 *Select Bank\\:*`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard(bankButtons)
          }
        );
        
        ctx.answerCbQuery('✅ Banks list refreshed');
      } catch (error) {
        console.error('❌ Refresh banks error:', error);
        ctx.answerCbQuery('❌ Failed to refresh banks');
      }
    },
    
    // Bank selection
    '^sendmoney_bank_(.+)$': async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        const bankCode = ctx.match[1];
        
        console.log(`💼 SendMoney: Bank callback - User: ${userId}, Bank: ${bankCode}`);
        
        // Check if session exists
        let session = sessionManager.getSession(userId);
        
        if (!session || session.action !== 'send_money') {
          console.log(`💼 SendMoney: Creating new session for user ${userId}`);
          session = sessionManager.startSession(userId, 'send_money');
        }
        
        // Get bank name
        const banks = await getBanks();
        const selectedBank = banks.find(b => b.code === bankCode);
        const bankName = selectedBank ? selectedBank.name : 'Unknown Bank';
        
        console.log(`💼 SendMoney: Bank selected: ${bankName} (${bankCode})`);
        
        sessionManager.updateStep(userId, 2, { 
          bankCode: bankCode, 
          bankName: bankName 
        });
        
        await ctx.editMessageText(
          `✅ *Bank Selected\\:* ${escapeMarkdown(bankName)}\n\n` +
          `🔢 *Enter recipient account number \\(10 digits\\)\\:*\n\n` +
          `📝 *Example\\:* 1234567890\n\n` +
          `💡 *Note\\:* Account name will be fetched automatically using Monnify\\.`,
          {
            parse_mode: 'MarkdownV2',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('⬅️ Back to Banks', 'sendmoney_refresh_banks')]
            ])
          }
        );
        
        ctx.answerCbQuery();
      } catch (error) {
        console.error('❌ Bank selection error:', error);
        ctx.answerCbQuery('❌ Error occurred');
      }
    }
  };
}

// Handle text messages for send money
async function handleText(ctx, text, users, transactions) {
  const userId = ctx.from.id.toString();
  const session = sessionManager.getSession(userId);
  
  console.log(`💼 SendMoney Text Handler - User: ${userId}, Text: "${text}"`);
  console.log(`💼 SendMoney: Current sessions:`, Object.keys(sendMoneySessions));
  console.log(`💼 SendMoney: User session:`, session);
  
  if (!session || session.action !== 'send_money') {
    console.log(`💼 SendMoney: No active send_money session for user ${userId}`);
    return false;
  }
  
  const user = users[userId];
  if (!user) {
    console.log(`💼 SendMoney: User ${userId} not found in database`);
    return false;
  }
  
  console.log(`💼 SendMoney: Processing step ${session.step} for user ${userId}`);
  
  try {
    if (session.step === 2) {
      // Account number input
      const accountNumber = text.replace(/\s+/g, '');
      
      if (!/^\d{10}$/.test(accountNumber)) {
        await ctx.reply(
          '❌ *INVALID ACCOUNT NUMBER*\n\n' +
          'Account number must be exactly 10 digits\\.\n\n' +
          '📝 Try again\\:',
          { parse_mode: 'MarkdownV2' }
        );
        return true;
      }
      
      console.log(`💼 SendMoney: Valid account number: ${accountNumber}`);
      sessionManager.updateStep(userId, 3, { accountNumber: accountNumber });
      
      const loadingMsg = await ctx.reply(
        `🔄 *Resolving account details with Monnify\\.\\.\\.*\n\n` +
        `🔢 *Account Number\\:* ${accountNumber}\n` +
        `🏦 *Bank\\:* ${escapeMarkdown(session.data.bankName)}\n\n` +
        `⏳ Please wait\\.\\.\\.`,
        { parse_mode: 'MarkdownV2' }
      );
      
      try {
        // Resolve account with Monnify
        const resolution = await resolveBankAccount(accountNumber, session.data.bankCode);
        
        if (!resolution.success) {
          console.log(`💼 SendMoney: Account resolution failed: ${resolution.error}`);
          await ctx.reply(
            `❌ *ACCOUNT RESOLUTION FAILED*\n\n` +
            `🔢 *Account Number\\:* ${accountNumber}\n` +
            `🏦 *Bank\\:* ${escapeMarkdown(session.data.bankName)}\n\n` +
            `📛 *Error\\:* ${escapeMarkdown(resolution.error)}\n\n` +
            `📛 *Please enter recipient account name manually\\:*\n\n` +
            `💡 *Example\\:* John Doe`,
            { parse_mode: 'MarkdownV2' }
          );
          
          sessionManager.updateStep(userId, 4); // Manual entry step
        } else {
          console.log(`💼 SendMoney: Account resolved successfully:`, resolution);
          
          // Fixed: Handle undefined bank name properly
          const resolvedBankName = resolution.bankName && resolution.bankName !== 'undefined' && resolution.bankName !== 'null'
            ? resolution.bankName 
            : (session.data.bankName || 'Selected Bank');
          
          // Also handle account name
          const resolvedAccountName = resolution.accountName && resolution.accountName !== 'undefined' && resolution.accountName !== 'null'
            ? resolution.accountName
            : 'Account Holder Name';
          
          sessionManager.updateStep(userId, 5, {
            accountName: resolvedAccountName,
            accountNumber: resolution.accountNumber || accountNumber,
            bankCode: resolution.bankCode || session.data.bankCode,
            bankName: resolvedBankName
          });
          
          // Fixed: Show proper message with clear bank name
          const bankDisplayName = resolvedBankName;
          
          await ctx.reply(
            `✅ *ACCOUNT RESOLVED*\n\n` +
            `🔢 *Account Number\\:* ${accountNumber}\n` +
            `📛 *Account Name\\:* ${escapeMarkdown(resolvedAccountName)}\n` +
            `🏦 *Bank\\:* ${escapeMarkdown(bankDisplayName)}\n\n` +
            `💰 *Enter amount to transfer\\:*\n\n` +
            `💸 *Fee\\:* ${CONFIG.TRANSFER_FEE_PERCENTAGE}%\n` +
            `💰 *Min\\:* ${formatCurrency(CONFIG.MIN_TRANSFER_AMOUNT)}\n` +
            `💎 *Max\\:* ${formatCurrency(CONFIG.MAX_TRANSFER_AMOUNT)}`,
            { parse_mode: 'MarkdownV2' }
          );
        }
      } catch (error) {
        console.error('❌ SendMoney: Account resolution error:', error);
        sessionManager.updateStep(userId, 4);
        
        await ctx.reply(
          `⚠️ *ACCOUNT RESOLUTION ERROR*\n\n` +
          `🔢 *Account Number\\:* ${accountNumber}\n` +
          `🏦 *Bank\\:* ${escapeMarkdown(session.data.bankName)}\n\n` +
          `📛 *Please enter recipient account name manually\\:*\n\n` +
          `💡 *Example\\:* John Doe`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
      } catch (e) {
        console.log('💼 SendMoney: Could not delete loading message:', e.message);
      }
      
      return true;
    }
    
    if (session.step === 4) {
      // Manual account name entry
      const accountName = text.substring(0, 100);
      console.log(`💼 SendMoney: Manual account name entered: ${accountName}`);
      
      sessionManager.updateStep(userId, 5, {
        accountName: accountName,
        accountNumber: session.data.accountNumber,
        bankCode: session.data.bankCode,
        bankName: session.data.bankName || 'Selected Bank'
      });
      
      await ctx.reply(
        `✅ *Account Name Saved\\:* ${escapeMarkdown(accountName)}\n\n` +
        `💰 *Enter amount to transfer\\:*\n\n` +
        `💸 *Fee\\:* ${CONFIG.TRANSFER_FEE_PERCENTAGE}%\n` +
        `💰 *Min\\:* ${formatCurrency(CONFIG.MIN_TRANSFER_AMOUNT)}\n` +
        `💎 *Max\\:* ${formatCurrency(CONFIG.MAX_TRANSFER_AMOUNT)}`,
        { parse_mode: 'MarkdownV2' }
      );
      return true;
    }
    
    if (session.step === 5) {
      // Amount entry
      const amount = parseFloat(text);
      console.log(`💼 SendMoney: Amount entered: ${amount}`);
      
      if (isNaN(amount) || amount < CONFIG.MIN_TRANSFER_AMOUNT || amount > CONFIG.MAX_TRANSFER_AMOUNT) {
        await ctx.reply(
          `❌ *INVALID AMOUNT*\n\n` +
          `Amount must be between ${formatCurrency(CONFIG.MIN_TRANSFER_AMOUNT)} and ${formatCurrency(CONFIG.MAX_TRANSFER_AMOUNT)}\\.\n\n` +
          `📝 Try again\\:`,
          { parse_mode: 'MarkdownV2' }
        );
        return true;
      }
      
      const fee = (amount * CONFIG.TRANSFER_FEE_PERCENTAGE) / 100;
      const total = amount + fee;
      
      if (user.wallet < total) {
        sessionManager.clearSession(userId);
        await ctx.reply(
          `❌ *INSUFFICIENT BALANCE*\n\n` +
          `💵 Your Balance\\: ${formatCurrency(user.wallet)}\n` +
          `💰 Required \\(Amount \\+ Fee\\)\\: ${formatCurrency(total)}\n\n` +
          `💡 You need ${formatCurrency(total - user.wallet)} more\\.`,
          { parse_mode: 'MarkdownV2' }
        );
        return true;
      }
      
      sessionManager.updateStep(userId, 6, {
        amount: amount,
        fee: fee,
        totalAmount: total
      });
      
      const bankDisplayName = session.data.bankName === 'Selected Bank' ? 'Selected Bank' : session.data.bankName;
      
      await ctx.reply(
        `📋 *TRANSFER SUMMARY*\n\n` +
        `📛 *To\\:* ${escapeMarkdown(session.data.accountName)}\n` +
        `🔢 *Account\\:* ${session.data.accountNumber}\n` +
        `🏦 *Bank\\:* ${escapeMarkdown(bankDisplayName)}\n` +
        `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
        `💸 *Fee\\:* ${formatCurrency(fee)}\n` +
        `💵 *Total Deducted\\:* ${formatCurrency(total)}\n\n` +
        `🔐 *Enter your 4\\-digit PIN to confirm transfer\\:*`,
        { parse_mode: 'MarkdownV2' }
      );
      return true;
    }
    
    if (session.step === 6) {
      // PIN confirmation
      console.log(`💼 SendMoney: PIN entered: ${text}, User PIN: ${user.pin}`);
      
      if (text !== user.pin) {
        user.pinAttempts++;
        
        if (user.pinAttempts >= 3) {
          user.pinLocked = true;
          sessionManager.clearSession(userId);
          
          await ctx.reply(
            '❌ *ACCOUNT LOCKED*\n\n' +
            '🔒 Too many wrong PIN attempts\\.\n\n' +
            '📞 Contact admin to unlock\\.',
            { parse_mode: 'MarkdownV2' }
          );
          return true;
        }
        
        await ctx.reply(
          `❌ *WRONG PIN*\n\n` +
          `⚠️ Attempts left\\: ${3 - user.pinAttempts}\n\n` +
          `🔐 Enter correct PIN\\:`,
          { parse_mode: 'MarkdownV2' }
        );
        return true;
      }
      
      // PIN correct, process transfer
      user.pinAttempts = 0;
      
      const { amount, fee, totalAmount } = session.data;
      const { accountNumber, accountName, bankName, bankCode } = session.data;
      
      console.log(`💼 SendMoney: Processing transfer: ${amount} to ${accountName}`);
      
      const processingMsg = await ctx.reply(
        `🔄 *PROCESSING BANK TRANSFER VIA MONNIFY\\.\\.\\.*\n\n` +
        `⏳ Please wait while we process your transfer\\.`,
        { parse_mode: 'MarkdownV2' }
      );
      
      try {
        // Deduct from wallet
        user.wallet -= totalAmount;
        user.dailyTransfer += totalAmount;
        user.lastTransfer = new Date().toLocaleString();
        
        const reference = `MTR${Date.now()}_${userId}`;
        
        // Create transaction record
        const transaction = {
          type: 'bank_transfer',
          amount: amount,
          fee: fee,
          totalAmount: totalAmount,
          recipientName: accountName,
          recipientAccount: accountNumber,
          recipientBank: bankName,
          reference: reference,
          status: 'pending',
          date: new Date().toLocaleString(),
          note: 'Transfer via Monnify'
        };
        
        // Add to transactions
        if (!transactions[userId]) {
          transactions[userId] = [];
        }
        transactions[userId].push(transaction);
        
        // Initiate Monnify transfer using v2 API
        const transferResult = await initiateTransfer({
          amount: amount,
          reference: reference,
          narration: `Transfer to ${accountName}`,
          accountNumber: accountNumber,
          accountName: accountName,
          bankCode: bankCode
        });
        
        if (transferResult.success) {
          // Update transaction status
          transaction.status = transferResult.requiresOTP ? 'pending_otp' : 'processing';
          transaction.paymentReference = transferResult.paymentReference;
          transaction.transactionReference = transferResult.transactionReference;
          transaction.completedAt = new Date().toLocaleString();
          transaction.monnifyResponse = transferResult.message;
          
          if (transferResult.requiresOTP) {
            // Store OTP session
            sessionManager.updateSession(userId, {
              step: 7, // OTP step
              transferReference: reference,
              transactionReference: transferResult.transactionReference
            });
            
            await ctx.reply(
              `🔐 *OTP REQUIRED*\n\n` +
              `📋 *Transfer Details\\:*\n` +
              `📛 To\\: ${escapeMarkdown(accountName)}\n` +
              `🔢 Account\\: ${accountNumber}\n` +
              `💰 Amount\\: ${formatCurrency(amount)}\n\n` +
              `📱 *Check your registered phone number for OTP*\n\n` +
              `🔢 *Enter the 6\\-digit OTP sent to your phone\\:*`,
              { parse_mode: 'MarkdownV2' }
            );
          } else {
            transaction.status = 'completed';
            
            const bankDisplayName = bankName === 'Selected Bank' ? 'Selected Bank' : bankName;
            
            await ctx.reply(
              `✅ *TRANSFER INITIATED SUCCESSFULLY\\!*\n\n` +
              `📛 *To\\:* ${escapeMarkdown(accountName)}\n` +
              `🔢 *Account\\:* ${accountNumber}\n` +
              `🏦 *Bank\\:* ${escapeMarkdown(bankDisplayName)}\n` +
              `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
              `💸 *Fee\\:* ${formatCurrency(fee)}\n` +
              `💵 *Total Deducted\\:* ${formatCurrency(totalAmount)}\n` +
              `🔢 *Reference\\:* ${reference}\n` +
              `📊 *Monnify Ref\\:* ${transferResult.transactionReference}\n` +
              `💳 *New Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
              `⚡ *Status\\:* ✅ PROCESSING\n\n` +
              `💡 *Note\\:* Funds should reflect within 24 hours\\.`,
              {
                parse_mode: 'MarkdownV2',
                ...Markup.inlineKeyboard([
                  [Markup.button.callback('📋 Save Receipt', `save_${reference}`)],
                  [Markup.button.callback('🏠 Home', 'start')]
                ])
              }
            );
            
            sessionManager.clearSession(userId);
          }
        } else {
          // Transfer failed, refund wallet
          user.wallet += totalAmount;
          user.dailyTransfer -= totalAmount;
          
          transaction.status = 'failed';
          transaction.error = transferResult.error;
          
          await ctx.reply(
            `❌ *TRANSFER FAILED*\n\n` +
            `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
            `📛 *To\\:* ${escapeMarkdown(accountName)}\n` +
            `🔢 *Account\\:* ${accountNumber}\n\n` +
            `⚠️ *Error\\:* ${escapeMarkdown(transferResult.error)}\n\n` +
            `💡 *Note\\:* Your wallet has been refunded\\.\n` +
            `Please try again or contact support\\.`,
            { parse_mode: 'MarkdownV2' }
          );
          
          sessionManager.clearSession(userId);
        }
        
      } catch (error) {
        console.error('❌ SendMoney: Transfer processing error:', error);
        
        // Refund on error
        user.wallet += totalAmount;
        user.dailyTransfer -= totalAmount;
        
        await ctx.reply(
          `⚠️ *TRANSFER ERROR*\n\n` +
          `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
          `📛 *To\\:* ${escapeMarkdown(accountName)}\n` +
          `🔢 *Account\\:* ${accountNumber}\n\n` +
          `❌ *Error\\:* ${escapeMarkdown(error.message)}\n\n` +
          `💡 *Note\\:* Your wallet has been refunded\\.\n` +
          `Please contact admin for assistance\\.`,
          { parse_mode: 'MarkdownV2' }
        );
        
        sessionManager.clearSession(userId);
      }
      
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
      } catch (e) {
        console.log('💼 SendMoney: Could not delete processing message:', e.message);
      }
      
      return true;
    }
    
    if (session.step === 7) {
      // OTP entry step
      const otp = text.replace(/\s+/g, '');
      
      if (!/^\d{6}$/.test(otp)) {
        await ctx.reply(
          '❌ *INVALID OTP*\n\n' +
          'OTP must be exactly 6 digits\\.\n\n' +
          '📝 Try again\\:',
          { parse_mode: 'MarkdownV2' }
        );
        return true;
      }
      
      const processingMsg = await ctx.reply(
        `🔄 *VERIFYING OTP WITH MONNIFY\\.\\.\\.*\n\n` +
        `⏳ Please wait\\.\\.\\.`,
        { parse_mode: 'MarkdownV2' }
      );
      
      try {
        const otpResult = await validateTransferOTP(session.data.transferReference, otp);
        
        if (otpResult.success) {
          // Find and update transaction
          const userTransactions = transactions[userId] || [];
          const transaction = userTransactions.find(t => t.reference === session.data.transferReference);
          
          if (transaction) {
            transaction.status = 'completed';
            transaction.otpVerified = true;
            transaction.completedAt = new Date().toLocaleString();
          }
          
          await ctx.reply(
            `✅ *OTP VERIFIED SUCCESSFULLY\\!*\n\n` +
            `🔢 *Reference\\:* ${session.data.transferReference}\n` +
            `📊 *Monnify Ref\\:* ${session.data.transactionReference}\n` +
            `⚡ *Status\\:* ✅ COMPLETED\n\n` +
            `💡 *Note\\:* Transfer is now being processed\\.\n` +
            `Funds should reflect within 24 hours\\.`,
            {
              parse_mode: 'MarkdownV2',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('📋 Save Receipt', `save_${session.data.transferReference}`)],
                [Markup.button.callback('🏠 Home', 'start')]
              ])
            }
          );
        } else {
          await ctx.reply(
            `❌ *OTP VERIFICATION FAILED*\n\n` +
            `⚠️ *Error\\:* ${escapeMarkdown(otpResult.error)}\n\n` +
            `📝 *Please try again with correct OTP\\:*`,
            { parse_mode: 'MarkdownV2' }
          );
          
          // Stay on OTP step for retry
          return true;
        }
        
      } catch (error) {
        console.error('❌ SendMoney: OTP verification error:', error);
        await ctx.reply(
          `⚠️ *OTP VERIFICATION ERROR*\n\n` +
          `❌ *Error\\:* ${escapeMarkdown(error.message)}\n\n` +
          `📞 Please contact admin for assistance\\.`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      try {
        await ctx.telegram.deleteMessage(ctx.chat.id, processingMsg.message_id);
      } catch (e) {
        console.log('💼 SendMoney: Could not delete processing message:', e.message);
      }
      
      sessionManager.clearSession(userId);
      return true;
    }
    
  } catch (error) {
    console.error('❌ SendMoney: Text handler error:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
    sessionManager.clearSession(userId);
    return true;
  }
  
  console.log(`💼 SendMoney: No matching step found for step ${session.step}`);
  return false;
}

// Export module
module.exports = {
  handleSendMoney,
  getCallbacks,
  handleText,
  sessionManager,
  isMonnifyConfigured: () => isMonnifyConfigured()
};