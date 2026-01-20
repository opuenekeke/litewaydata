// app/sendmoney.js
const axios = require('axios');
const { Markup } = require('telegraf');

// Configuration
const CONFIG = {
  MONNIFY_API_KEY: process.env.MONNIFY_API_KEY,
  MONNIFY_SECRET_KEY: process.env.MONNIFY_SECRET_KEY,
  MONNIFY_CONTRACT_CODE: process.env.MONNIFY_CONTRACT_CODE,
  MONNIFY_BASE_URL: process.env.MONNIFY_BASE_URL || 'https://api.monnify.com',
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

// ... (rest of the functions remain the same - getMonnifyToken, resolveBankAccount, getBanks, initiateTransfer, formatCurrency, escapeMarkdown, isMonnifyConfigured)

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
    
    // Create bank buttons (pagination can be added if needed)
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
        const session = sessionManager.getSession(userId);
        
        console.log(`💼 SendMoney: Bank callback - User: ${userId}, Bank: ${bankCode}`);
        console.log(`💼 SendMoney: Current session:`, session);
        
        if (!session || session.action !== 'send_money') {
          console.log(`💼 SendMoney: Invalid session - starting new`);
          sessionManager.startSession(userId, 'send_money');
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
  const session = sessionManager.getSession(userId); // Use our own session manager
  
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
          console.log(`💼 SendMoney: Account resolved successfully: ${resolution.accountName}`);
          sessionManager.updateStep(userId, 5, {
            accountName: resolution.accountName,
            accountNumber: resolution.accountNumber,
            bankCode: resolution.bankCode,
            bankName: resolution.bankName
          });
          
          await ctx.reply(
            `✅ *ACCOUNT RESOLVED*\n\n` +
            `🔢 *Account Number\\:* ${accountNumber}\n` +
            `📛 *Account Name\\:* ${escapeMarkdown(resolution.accountName)}\n` +
            `🏦 *Bank\\:* ${escapeMarkdown(resolution.bankName)}\n\n` +
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
    
    // Continue with other steps (4, 5, 6) as before...
    if (session.step === 4) {
      // Manual account name entry
      const accountName = text.substring(0, 100);
      console.log(`💼 SendMoney: Manual account name entered: ${accountName}`);
      sessionManager.updateStep(userId, 5, {
        accountName: accountName,
        accountNumber: session.data.accountNumber,
        bankCode: session.data.bankCode,
        bankName: session.data.bankName
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
      
      await ctx.reply(
        `📋 *TRANSFER SUMMARY*\n\n` +
        `📛 *To\\:* ${escapeMarkdown(session.data.accountName)}\n` +
        `🔢 *Account\\:* ${session.data.accountNumber}\n` +
        `🏦 *Bank\\:* ${escapeMarkdown(session.data.bankName)}\n` +
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
        
        // Initiate Monnify transfer
        const transferResult = await initiateTransfer({
          amount: amount,
          reference: reference,
          narration: `Transfer to ${accountName}`,
          destinationBankCode: bankCode,
          destinationAccountNumber: accountNumber,
          destinationAccountName: accountName
        });
        
        if (transferResult.success) {
          // Update transaction status
          transaction.status = 'completed';
          transaction.paymentReference = transferResult.paymentReference;
          transaction.transactionReference = transferResult.transactionReference;
          transaction.completedAt = new Date().toLocaleString();
          
          await ctx.reply(
            `✅ *TRANSFER SUCCESSFUL\\!*\n\n` +
            `📛 *To\\:* ${escapeMarkdown(accountName)}\n` +
            `🔢 *Account\\:* ${accountNumber}\n` +
            `🏦 *Bank\\:* ${escapeMarkdown(bankName)}\n` +
            `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
            `💸 *Fee\\:* ${formatCurrency(fee)}\n` +
            `💵 *Total Deducted\\:* ${formatCurrency(totalAmount)}\n` +
            `🔢 *Reference\\:* ${reference}\n` +
            `💳 *New Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
            `⚡ *Status\\:* ✅ COMPLETED\n\n` +
            `💡 *Note\\:* Funds should reflect within 24 hours\\.`,
            {
              parse_mode: 'MarkdownV2',
              ...Markup.inlineKeyboard([
                [Markup.button.callback('📋 Save Receipt', `save_${reference}`)],
                [Markup.button.callback('🏠 Home', 'start')]
              ])
            }
          );
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
        }
        
      } catch (error) {
        console.error('❌ SendMoney: Transfer processing error:', error);
        
        await ctx.reply(
          `⚠️ *TRANSFER ERROR*\n\n` +
          `💰 *Amount\\:* ${formatCurrency(amount)}\n` +
          `📛 *To\\:* ${escapeMarkdown(accountName)}\n` +
          `🔢 *Account\\:* ${accountNumber}\n\n` +
          `🔄 *Status\\:* Processing \\- Please wait\n\n` +
          `💡 *Note\\:* If transfer doesn\'t complete, contact admin\\.`,
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

// Also, make sure all the helper functions are included (getMonnifyToken, resolveBankAccount, etc.)
// I'll include them here for completeness:

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
    
    return {
      success: true,
      accountName: response.data.responseBody.accountName,
      accountNumber: response.data.responseBody.accountNumber,
      bankCode: response.data.responseBody.bankCode,
      bankName: response.data.responseBody.bankName
    };
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
    
    const payload = {
      amount: transferData.amount,
      reference: transferData.reference,
      narration: transferData.narration || `Transfer to ${transferData.accountName}`,
      destinationBankCode: transferData.bankCode,
      destinationAccountNumber: transferData.accountNumber,
      destinationAccountName: transferData.accountName,
      currency: "NGN",
      sourceAccountNumber: "default"
    };
    
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
    
    return {
      success: true,
      transactionReference: response.data.responseBody.transactionReference,
      paymentReference: response.data.responseBody.paymentReference,
      amount: response.data.responseBody.amount,
      status: response.data.responseBody.status
    };
  } catch (error) {
    console.error('❌ Transfer initiation error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.responseMessage || 'Transfer failed'
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
  return CONFIG.MONNIFY_API_KEY && CONFIG.MONNIFY_SECRET_KEY && CONFIG.MONNIFY_CONTRACT_CODE;
}

// Export module
module.exports = {
  handleSendMoney,
  getCallbacks,
  handleText,
  sessionManager,
  isMonnifyConfigured: () => isMonnifyConfigured()
};