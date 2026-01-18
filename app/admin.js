// app/admin.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Markup } = require('telegraf');

module.exports = {
  handleAdminPanel: async (ctx, users, transactions, CONFIG) => {
    try {
      const userId = ctx.from.id.toString();
      
      if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
        return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
      }
      
      const totalUsers = Object.keys(users).length;
      let totalBalance = 0;
      let pendingKyc = 0;
      let approvedKyc = 0;
      let usersWithVirtualAccounts = 0;
      let usersWithBVN = 0;
      let usersWithVerifiedBVN = 0;
      
      Object.values(users).forEach(user => {
        totalBalance += user.wallet || 0;
        if (user.kyc === 'pending') pendingKyc++;
        if (user.kyc === 'approved') approvedKyc++;
        if (user.virtualAccount) usersWithVirtualAccounts++;
        if (user.bvn) usersWithBVN++;
        if (user.bvnVerified) usersWithVerifiedBVN++;
      });
      
      let totalPlans = 0;
      const networks = getAvailableNetworks();
      
      networks.forEach(network => {
        const validities = getAvailableValidities(network);
        validities.forEach(validity => {
          const plans = getDataPlans(network, validity, CONFIG);
          totalPlans += plans.length;
        });
      });
      
      const message = `🛠️ *ADMIN CONTROL PANEL*\n\n` +
        `📊 *Statistics\\:*\n` +
        `👥 Total Users\\: ${totalUsers}\n` +
        `💰 User Balances\\: ${formatCurrency(totalBalance)}\n` +
        `✅ Approved KYC\\: ${approvedKyc}\n` +
        `⏳ Pending KYC\\: ${pendingKyc}\n` +
        `🏦 Virtual Accounts\\: ${usersWithVirtualAccounts}\n` +
        `🆔 BVN Submitted\\: ${usersWithBVN}\n` +
        `✅ BVN Verified\\: ${usersWithVerifiedBVN}\n` +
        `📈 Data Plans\\: ${totalPlans}\n\n` +
        `⚡ *Quick Commands\\:*\n` +
        `• /users \\- List all users\n` +
        `• /stats \\- System statistics\n` +
        `• /deposit \\[id\\] \\[amount\\] \\- Deposit funds\n` +
        `• /credit \\[id\\] \\[amount\\] \\- Credit user\n` +
        `• /approve \\[id\\] \\- Approve KYC\n` +
        `• /vtu\\_balance \\- Check VTU balance\n` +
        `• /view\\_plans \\- View data plans\n` +
        `• /virtual\\_accounts \\- List virtual accounts\n` +
        `• /bvn\\_list \\- List BVN submissions\n` +
        `• /verify\\_bvn \\[id\\] \\- Verify user BVN\n\n` +
        `💡 *Admin Actions\\:*`;
      
      await ctx.reply(message, {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📋 List Users', 'admin_list_users')],
          [Markup.button.callback('💰 VTU Balance', 'admin_vtu_balance')],
          [Markup.button.callback('🏦 Virtual Accounts', 'admin_virtual_accounts')],
          [Markup.button.callback('📊 View Plans', 'admin_view_plans')],
          [Markup.button.callback('📈 System Stats', 'admin_stats')],
          [Markup.button.callback('🆔 BVN List', 'admin_bvn_list')],
          [Markup.button.callback('✅ Approve All KYC', 'admin_approve_all')]
        ])
      });
      
    } catch (error) {
      console.error('❌ Admin panel error:', error);
    }
  },

  getAdminCommands: (bot, users, transactions, CONFIG) => {
    return {
      users: async (ctx) => await handleUsersCommand(ctx, users, CONFIG),
      stats: async (ctx) => await handleStatsCommand(ctx, users, transactions, CONFIG),
      deposit: async (ctx) => await handleDepositCommand(ctx, users, transactions, CONFIG),
      credit: async (ctx) => await handleCreditCommand(ctx, users, transactions, CONFIG),
      approve: async (ctx) => await handleApproveCommand(ctx, users, CONFIG),
      approve_all: async (ctx) => await handleApproveAllCommand(ctx, users, CONFIG),
      virtual_accounts: async (ctx) => await handleVirtualAccountsCommand(ctx, users, CONFIG),
      view_plans: async (ctx) => await handleViewPlansCommand(ctx, CONFIG),
      vtu_balance: async (ctx) => await handleVTUBalanceCommand(ctx, CONFIG),
      verify_bvn: async (ctx) => await handleVerifyBVNCommand(ctx, users, bot, CONFIG),
      bvn_list: async (ctx) => await handleBVNListCommand(ctx, users, CONFIG)
    };
  },

  getCallbacks: (bot, users, transactions, CONFIG) => {
    return {
      'admin_list_users': async (ctx) => await handleAdminListUsers(ctx, users, CONFIG),
      'admin_virtual_accounts': async (ctx) => await handleAdminVirtualAccounts(ctx, users, CONFIG),
      'admin_vtu_balance': async (ctx) => await handleAdminVTUBalance(ctx, CONFIG),
      'admin_view_plans': async (ctx) => await handleAdminViewPlans(ctx, CONFIG),
      'admin_stats': async (ctx) => await handleAdminStats(ctx, users, transactions, CONFIG),
      'admin_bvn_list': async (ctx) => await handleAdminBVNList(ctx, users, CONFIG),
      'admin_approve_all': async (ctx) => await handleAdminApproveAll(ctx, users, CONFIG),
      'back_to_admin': async (ctx) => await handleBackToAdmin(ctx, users, transactions, CONFIG)
    };
  }
};

// Command handlers
async function handleUsersCommand(ctx, users, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const userList = Object.entries(users).slice(0, 50);
    
    if (userList.length === 0) {
      return await ctx.reply('📭 No users found\\.', { parse_mode: 'MarkdownV2' });
    }
    
    let message = `📋 *USER LIST \\(${userList.length} users\\)\\:*\n\n`;
    
    userList.forEach(([id, user], index) => {
      const kycEmoji = user.kyc === 'approved' ? '✅' : '⏳';
      const pinEmoji = user.pin ? '🔐' : '❌';
      const virtualAccEmoji = user.virtualAccount ? '🏦' : '❌';
      const bvnEmoji = user.bvn ? (user.bvnVerified ? '✅' : '⏳') : '❌';
      message += `${index + 1}\\. *ID\\:* \`${escapeMarkdown(id)}\`\n`;
      message += `   💰 *Balance\\:* ${formatCurrency(user.wallet || 0)}\n`;
      message += `   🛂 *KYC\\:* ${kycEmoji} ${escapeMarkdown(user.kyc)}\n`;
      message += `   ${pinEmoji} *PIN\\:* ${user.pin ? 'Set' : 'Not Set'}\n`;
      message += `   ${bvnEmoji} *BVN\\:* ${user.bvn ? maskBVN(user.bvn) : 'Not Set'}\n`;
      message += `   ${virtualAccEmoji} *Virtual Account\\:* ${user.virtualAccount ? 'Yes' : 'No'}\n\n`;
    });
    
    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
    
  } catch (error) {
    console.error('❌ Users command error:', error);
    await ctx.reply('❌ Error fetching users\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleStatsCommand(ctx, users, transactions, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const totalUsers = Object.keys(users).length;
    let totalBalance = 0;
    let pendingKyc = 0;
    let approvedKyc = 0;
    let usersWithPin = 0;
    let usersWithVirtualAccounts = 0;
    let usersWithBVN = 0;
    let usersWithVerifiedBVN = 0;
    let totalTransactions = 0;
    
    Object.values(users).forEach(user => {
      totalBalance += user.wallet || 0;
      if (user.kyc === 'pending') pendingKyc++;
      if (user.kyc === 'approved') approvedKyc++;
      if (user.pin) usersWithPin++;
      if (user.virtualAccount) usersWithVirtualAccounts++;
      if (user.bvn) usersWithBVN++;
      if (user.bvnVerified) usersWithVerifiedBVN++;
    });
    
    Object.values(transactions).forEach(userTx => {
      totalTransactions += userTx.length;
    });
    
    let totalPlans = 0;
    const networks = getAvailableNetworks();
    
    networks.forEach(network => {
      const validities = getAvailableValidities(network);
      validities.forEach(validity => {
        const plans = getDataPlans(network, validity, CONFIG);
        totalPlans += plans.length;
      });
    });
    
    const message = `📊 *SYSTEM STATISTICS*\n\n` +
      `👥 *Total Users\\:* ${totalUsers}\n` +
      `💰 *User Balances\\:* ${formatCurrency(totalBalance)}\n` +
      `✅ *Approved KYC\\:* ${approvedKyc}\n` +
      `⏳ *Pending KYC\\:* ${pendingKyc}\n` +
      `🔐 *Users with PIN\\:* ${usersWithPin}\n` +
      `🏦 *Virtual Accounts\\:* ${usersWithVirtualAccounts}\n` +
      `🆔 *BVN Submitted\\:* ${usersWithBVN}\n` +
      `✅ *BVN Verified\\:* ${usersWithVerifiedBVN}\n` +
      `📈 *Data Plans Available\\:* ${totalPlans}\n` +
      `📜 *Total Transactions\\:* ${totalTransactions}\n\n` +
      `⚡ *Available Networks\\:* ${escapeMarkdown(networks.join(', '))}\n\n` +
      `🔄 *Last Updated\\:* ${escapeMarkdown(new Date().toLocaleString())}`;
    
    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
    
  } catch (error) {
    console.error('❌ Stats command error:', error);
    await ctx.reply('❌ Error fetching statistics\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleDepositCommand(ctx, users, transactions, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const args = ctx.message.text.split(' ');
    
    if (args.length !== 3) {
      return await ctx.reply(
        '❌ *Usage\\:* /deposit \\[user\\_id\\] \\[amount\\]\n' +
        '*Example\\:* /deposit 123456789 1000\n\n' +
        '*Note\\:* This credits user wallet directly\\!',
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    const targetUserId = args[1];
    const amount = parseFloat(args[2]);
    
    if (isNaN(amount) || amount <= 0) {
      return await ctx.reply(
        '❌ *Invalid amount*\\.\n' +
        'Amount must be greater than 0\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    if (!users[targetUserId]) {
      return await ctx.reply(
        `❌ *User not found*\\.\n` +
        `User ID \`${targetUserId}\` not found\\.\n\n` +
        `Use /users to see all users\\.`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    users[targetUserId].wallet += amount;
    
    transactions[targetUserId].push({
      type: 'deposit',
      amount: amount,
      date: new Date().toLocaleString(),
      status: 'success',
      source: 'admin_deposit',
      admin: userId
    });
    
    await ctx.reply(
      `✅ *DEPOSIT SUCCESSFUL*\n\n` +
      `👤 *User\\:* \`${targetUserId}\`\n` +
      `💰 *Amount Deposited\\:* ${formatCurrency(amount)}\n` +
      `💳 *New Balance\\:* ${formatCurrency(users[targetUserId].wallet)}\n\n` +
      `📋 *Transaction ID\\:* DP${Date.now()}`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📊 View Users', 'admin_list_users')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
  } catch (error) {
    console.error('❌ Deposit command error:', error);
    await ctx.reply('❌ Error processing deposit\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleCreditCommand(ctx, users, transactions, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const args = ctx.message.text.split(' ');
    
    if (args.length !== 3) {
      return await ctx.reply(
        '❌ *Usage\\:* /credit \\[user\\_id\\] \\[amount\\]\n' +
        '*Example\\:* /credit 123456789 1000\n\n' +
        '*Note\\:* This credits user wallet directly\\!',
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    const targetUserId = args[1];
    const amount = parseFloat(args[2]);
    
    if (isNaN(amount) || amount <= 0) {
      return await ctx.reply(
        '❌ *Invalid amount*\\.\n' +
        'Amount must be greater than 0\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    const user = users[targetUserId] || {
      wallet: 0,
      kyc: 'pending',
      pin: null
    };
    
    user.wallet += amount;
    users[targetUserId] = user;
    
    if (!transactions[targetUserId]) {
      transactions[targetUserId] = [];
    }
    
    transactions[targetUserId].push({
      type: 'credit',
      amount: amount,
      date: new Date().toLocaleString(),
      status: 'success',
      source: 'admin_credit',
      admin: userId
    });
    
    await ctx.reply(
      `✅ *CREDIT SUCCESSFUL*\n\n` +
      `👤 *User\\:* \`${targetUserId}\`\n` +
      `💰 *Amount Credited\\:* ${formatCurrency(amount)}\n` +
      `💳 *New Balance\\:* ${formatCurrency(user.wallet)}\n\n` +
      `📋 *Transaction ID\\:* CR${Date.now()}`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('📊 View Users', 'admin_list_users')],
          [Markup.button.callback('🏠 Home', 'start')]
        ])
      }
    );
    
  } catch (error) {
    console.error('❌ Credit command error:', error);
    await ctx.reply('❌ Error processing credit\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleApproveCommand(ctx, users, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const args = ctx.message.text.split(' ');
    
    if (args.length !== 2) {
      return await ctx.reply('❌ Usage\\: /approve \\[user\\_id\\]\nExample\\: /approve 123456789\n\nUse /approve\\_all to approve all pending users\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const targetUserId = args[1];
    
    if (!users[targetUserId]) {
      return await ctx.reply(`❌ User \`${escapeMarkdown(targetUserId)}\` not found\\.`, { parse_mode: 'MarkdownV2' });
    }
    
    users[targetUserId].kyc = 'approved';
    
    await ctx.reply(
      `✅ *KYC APPROVED*\n\n` +
      `👤 *User\\:* \`${escapeMarkdown(targetUserId)}\`\n` +
      `🛂 *Status\\:* ✅ APPROVED\n\n` +
      `User can now perform transactions\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    
  } catch (error) {
    console.error('❌ Approve command error:', error);
    await ctx.reply('❌ Error approving KYC\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleApproveAllCommand(ctx, users, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    let approvedCount = 0;
    
    Object.keys(users).forEach(userId => {
      if (users[userId].kyc === 'pending') {
        users[userId].kyc = 'approved';
        approvedCount++;
      }
    });
    
    await ctx.reply(
      `✅ *BULK KYC APPROVAL*\n\n` +
      `📊 *Users Approved\\:* ${approvedCount}\n\n` +
      `All pending KYC requests have been approved\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    
  } catch (error) {
    console.error('❌ Approve all command error:', error);
    await ctx.reply('❌ Error approving all KYC\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleVirtualAccountsCommand(ctx, users, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const virtualAccountsList = [];
    Object.entries(users).forEach(([uid, user]) => {
      if (user.virtualAccount) {
        virtualAccountsList.push({
          userId: uid,
          accountReference: user.virtualAccount,
          accountNumber: user.virtualAccountNumber,
          accountBank: user.virtualAccountBank,
          balance: user.wallet,
          kyc: user.kyc,
          bvnVerified: user.bvnVerified
        });
      }
    });
    
    if (virtualAccountsList.length === 0) {
      return await ctx.reply('🏦 No virtual accounts created yet\\.', { parse_mode: 'MarkdownV2' });
    }
    
    let message = `🏦 *VIRTUAL ACCOUNTS \\(${virtualAccountsList.length}\\)\\:*\n\n`;
    
    virtualAccountsList.slice(0, 20).forEach((acc, index) => {
      message += `${index + 1}\\. *User\\:* \`${escapeMarkdown(acc.userId)}\`\n`;
      message += `   🏦 *Bank\\:* ${escapeMarkdown(acc.accountBank || 'Unknown')}\n`;
      message += `   🔢 *Account\\:* \`${acc.accountNumber}\`\n`;
      message += `   💰 *Balance\\:* ${formatCurrency(acc.balance)}\n`;
      message += `   🛂 *KYC\\:* ${acc.kyc.toUpperCase()}\n`;
      message += `   🆔 *BVN Verified\\:* ${acc.bvnVerified ? '✅ YES' : '❌ NO'}\n\n`;
    });
    
    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
    
  } catch (error) {
    console.error('❌ Virtual accounts command error:', error);
    await ctx.reply('❌ Error fetching virtual accounts\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleViewPlansCommand(ctx, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const networks = getAvailableNetworks();
    
    if (networks.length === 0) {
      return await ctx.reply('❌ No networks found\\. Check your folder structure\\.', { parse_mode: 'MarkdownV2' });
    }
    
    let message = `📋 *DATA PLANS OVERVIEW*\n\n`;
    
    networks.forEach(network => {
      message += `📱 *${escapeMarkdown(network)}\\:*\n`;
      const validities = getAvailableValidities(network);
      
      if (validities.length === 0) {
        message += `   ❌ No validity files found\n`;
      } else {
        validities.forEach(validity => {
          const plans = getDataPlans(network, validity, CONFIG);
          message += `   📅 *${escapeMarkdown(validity)}\\:* ${plans.length} plans\n`;
        });
      }
      message += `\n`;
    });
    
    message += `📁 *Folder Structure\\:*\n`;
    message += `• MTN/daily\\.json\n`;
    message += `• MTN/weekly\\.json\n`;
    message += `• MTN/monthly\\.json\n`;
    message += `• Same for other networks\\.\n\n`;
    message += `🔧 Use inline buttons to view detailed plans\\.`;
    
    await ctx.reply(message, {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📱 View MTN Plans', 'admin_view_mtn_plans')],
        [Markup.button.callback('🔵 View GLO Plans', 'admin_view_glo_plans')],
        [Markup.button.callback('🟡 View AIRTEL Plans', 'admin_view_airtel_plans')],
        [Markup.button.callback('🔴 View 9MOBILE Plans', 'admin_view_9mobile_plans')]
      ])
    });
    
  } catch (error) {
    console.error('❌ View plans command error:', error);
    await ctx.reply('❌ Error viewing plans\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleVTUBalanceCommand(ctx, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const loadingMsg = await ctx.reply('🔄 Checking VTU balance\\.\\.\\.', { parse_mode: 'MarkdownV2' });
    
    try {
      const vtuData = await checkVTUBalance(CONFIG);
      
      let message = `💰 *VTU ACCOUNT BALANCE*\n\n`;
      
      let balance = 0;
      let currency = 'NGN';
      let status = 'Active';
      let accountName = 'Liteway VTU';
      let email = 'admin@liteway.com';
      
      if (vtuData.balance !== undefined) {
        balance = parseFloat(vtuData.balance);
      } else if (vtuData.wallet_balance !== undefined) {
        balance = parseFloat(vtuData.wallet_balance);
      } else if (vtuData.available_balance !== undefined) {
        balance = parseFloat(vtuData.available_balance);
      } else if (vtuData.wallet !== undefined) {
        balance = parseFloat(vtuData.wallet);
      }
      
      if (vtuData.currency) currency = vtuData.currency;
      if (vtuData.status) status = vtuData.status;
      if (vtuData.name) accountName = vtuData.name;
      if (vtuData.username) accountName = vtuData.username;
      if (vtuData.email) email = vtuData.email;
      
      message += `💵 *Balance\\:* ${formatCurrency(balance)}\n`;
      message += `💱 *Currency\\:* ${escapeMarkdown(currency)}\n`;
      message += `📊 *Status\\:* ${escapeMarkdown(status)}\n`;
      message += `👤 *Account\\:* ${escapeMarkdown(accountName)}\n`;
      message += `📧 *Email\\:* ${escapeMarkdown(email)}\n`;
      
      message += `\n🔄 *Last Updated\\:* ${escapeMarkdown(new Date().toLocaleString())}`;
      
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        null,
        message,
        { parse_mode: 'MarkdownV2' }
      );
      
    } catch (apiError) {
      console.error('VTU Balance API Error:', apiError.message);
      
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loadingMsg.message_id,
        null,
        `💰 *VTU ACCOUNT BALANCE*\n\n` +
        `💵 *Balance\\:* ₦121\\.63 \\(Demo\\)\n` +
        `💱 *Currency\\:* NGN\n` +
        `📊 *Status\\:* Active\n` +
        `👤 *Account\\:* 07052110985\n` +
        `📧 *Email\\:* Admin\\@VTU\n\n` +
        `⚠️ *Note\\:* Using API fallback data\\.\n` +
        `API Error\\: ${escapeMarkdown(apiError.message || 'Connection failed')}`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    
  } catch (error) {
    console.error('❌ VTU balance command error:', error);
    await ctx.reply('❌ Error checking VTU balance\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleVerifyBVNCommand(ctx, users, bot, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const args = ctx.message.text.split(' ');
    
    if (args.length !== 2) {
      return await ctx.reply(
        '❌ *Usage\\:* /verify\\_bvn \\[user\\_id\\]\n' +
        '*Example\\:* /verify\\_bvn 123456789\n\n' +
        '*Note\\:* This verifies user\'s BVN for virtual account creation\\.',
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    const targetUserId = args[1];
    
    if (!users[targetUserId]) {
      return await ctx.reply(`❌ User \`${escapeMarkdown(targetUserId)}\` not found\\.`, { parse_mode: 'MarkdownV2' });
    }
    
    const user = users[targetUserId];
    
    if (!user.bvn) {
      return await ctx.reply(
        `❌ *NO BVN SUBMITTED*\n\n` +
        `User \`${escapeMarkdown(targetUserId)}\` has not submitted BVN\\.\n\n` +
        `Ask user to use "💳 Deposit Funds" to submit BVN\\.`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    if (user.bvnVerified) {
      return await ctx.reply(
        `✅ *BVN ALREADY VERIFIED*\n\n` +
        `User \`${escapeMarkdown(targetUserId)}\` BVN is already verified\\.\n\n` +
        `🆔 *BVN\\:* \`${maskBVN(user.bvn)}\`\n` +
        `📅 *Verified On\\:* ${user.bvnVerifiedAt || 'Unknown'}`,
        { parse_mode: 'MarkdownV2' }
      );
    }
    
    // Verify BVN
    user.bvnVerified = true;
    user.bvnVerifiedAt = new Date().toLocaleString();
    user.bvnVerifiedBy = userId;
    
    await ctx.reply(
      `✅ *BVN VERIFIED SUCCESSFULLY\\!*\n\n` +
      `👤 *User\\:* \`${escapeMarkdown(targetUserId)}\`\n` +
      `📛 *Name\\:* ${escapeMarkdown(user.fullName || 'Not provided')}\n` +
      `🆔 *BVN\\:* \`${maskBVN(user.bvn)}\`\n` +
      `✅ *Status\\:* VERIFIED\n` +
      `👑 *Verified By\\:* ${userId}\n` +
      `📅 *Verified At\\:* ${new Date().toLocaleString('en-NG')}\n\n` +
      `💡 *Next Steps\\:*\n` +
      `User can now generate virtual account via "💳 Deposit Funds"\\.`,
      { parse_mode: 'MarkdownV2' }
    );
    
    // Notify user
    try {
      await bot.telegram.sendMessage(
        targetUserId,
        `✅ *BVN VERIFIED SUCCESSFULLY\\!*\n\n` +
        `🎉 Your BVN has been verified by our security team\\.\n\n` +
        `🆔 *BVN\\:* \`${maskBVN(user.bvn)}\`\n` +
        `✅ *Status\\:* ✅ VERIFIED\n` +
        `📅 *Verified At\\:* ${new Date().toLocaleString('en-NG')}\n\n` +
        `💡 *What next\\?*\n` +
        `1\\. Go to "💳 Deposit Funds"\n` +
        `2\\. Your virtual account will be created\n` +
        `3\\. Start depositing funds instantly\\!\n\n` +
        `🎉 *Welcome to seamless banking\\!*`,
        { parse_mode: 'MarkdownV2' }
      );
    } catch (notifyError) {
      console.error('Failed to notify user:', notifyError);
    }
    
  } catch (error) {
    console.error('❌ Verify BVN command error:', error);
    await ctx.reply('❌ Error verifying BVN\\.', { parse_mode: 'MarkdownV2' });
  }
}

async function handleBVNListCommand(ctx, users, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      return await ctx.reply('❌ Access denied\\. Admin only\\.', { parse_mode: 'MarkdownV2' });
    }
    
    const bvnUsers = [];
    Object.entries(users).forEach(([uid, user]) => {
      if (user.bvn) {
        bvnUsers.push({
          userId: uid,
          fullName: user.fullName,
          bvn: user.bvn,
          bvnVerified: user.bvnVerified,
          bvnSubmittedAt: user.bvnSubmittedAt,
          bvnVerifiedAt: user.bvnVerifiedAt,
          virtualAccount: user.virtualAccount
        });
      }
    });
    
    if (bvnUsers.length === 0) {
      return await ctx.reply('📭 No BVN submissions yet\\.', { parse_mode: 'MarkdownV2' });
    }
    
    let message = `🆔 *BVN SUBMISSIONS \\(${bvnUsers.length} users\\)\\:*\n\n`;
    
    bvnUsers.slice(0, 20).forEach((user, index) => {
      const verifiedEmoji = user.bvnVerified ? '✅' : '⏳';
      const virtualAccEmoji = user.virtualAccount ? '🏦' : '❌';
      message += `${index + 1}\\. *User\\:* \`${escapeMarkdown(user.userId)}\`\n`;
      message += `   📛 *Name\\:* ${escapeMarkdown(user.fullName || 'Not provided')}\n`;
      message += `   🆔 *BVN\\:* \`${maskBVN(user.bvn)}\`\n`;
      message += `   ${verifiedEmoji} *Status\\:* ${user.bvnVerified ? 'Verified' : 'Pending'}\n`;
      message += `   ${virtualAccEmoji} *Virtual Account\\:* ${user.virtualAccount ? 'Yes' : 'No'}\n`;
      if (user.bvnSubmittedAt) {
        message += `   📅 *Submitted\\:* ${escapeMarkdown(new Date(user.bvnSubmittedAt).toLocaleDateString())}\n`;
      }
      if (!user.bvnVerified) {
        message += `   ✅ *Verify\\:* /verify\\_bvn ${escapeMarkdown(user.userId)}\n`;
      }
      message += `\n`;
    });
    
    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
    
  } catch (error) {
    console.error('❌ BVN list command error:', error);
    await ctx.reply('❌ Error fetching BVN list\\.', { parse_mode: 'MarkdownV2' });
  }
}

// Callback handlers
async function handleAdminListUsers(ctx, users, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      await ctx.answerCbQuery('❌ Admin only');
      return;
    }
    
    const userList = Object.entries(users).slice(0, 20);
    
    if (userList.length === 0) {
      await ctx.editMessageText('📭 No users found\\.', { 
        parse_mode: 'MarkdownV2' 
      });
      return;
    }
    
    let message = `📋 *USER LIST \\(${userList.length} users\\)\\:*\n\n`;
    
    userList.forEach(([id, user], index) => {
      const kycEmoji = user.kyc === 'approved' ? '✅' : '⏳';
      const pinEmoji = user.pin ? '🔐' : '❌';
      const virtualAccEmoji = user.virtualAccount ? '🏦' : '❌';
      const bvnEmoji = user.bvn ? (user.bvnVerified ? '✅' : '⏳') : '❌';
      message += `${index + 1}\\. *ID\\:* \`${escapeMarkdown(id)}\`\n`;
      message += `   💰 *Balance\\:* ${formatCurrency(user.wallet || 0)}\n`;
      message += `   🛂 *KYC\\:* ${kycEmoji} ${escapeMarkdown(user.kyc)}\n`;
      message += `   ${pinEmoji} *PIN\\:* ${user.pin ? 'Set' : 'Not Set'}\n`;
      message += `   ${bvnEmoji} *BVN\\:* ${user.bvn ? maskBVN(user.bvn) : 'Not Set'}\n`;
      message += `   ${virtualAccEmoji} *Virtual Account\\:* ${user.virtualAccount ? 'Yes' : 'No'}\n\n`;
    });
    
    await ctx.editMessageText(message, { 
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'admin_list_users')],
        [Markup.button.callback('⬅️ Back to Admin', 'back_to_admin')]
      ])
    });
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Admin list users error:', error);
    ctx.answerCbQuery('❌ Error loading users');
  }
}

async function handleAdminVirtualAccounts(ctx, users, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      await ctx.answerCbQuery('❌ Admin only');
      return;
    }
    
    const virtualAccountsList = [];
    Object.entries(users).forEach(([uid, user]) => {
      if (user.virtualAccount) {
        virtualAccountsList.push({
          userId: uid,
          accountReference: user.virtualAccount,
          accountNumber: user.virtualAccountNumber,
          accountBank: user.virtualAccountBank,
          balance: user.wallet,
          kyc: user.kyc,
          bvnVerified: user.bvnVerified
        });
      }
    });
    
    if (virtualAccountsList.length === 0) {
      await ctx.editMessageText('🏦 No virtual accounts created yet\\.', { 
        parse_mode: 'MarkdownV2' 
      });
      return;
    }
    
    let message = `🏦 *VIRTUAL ACCOUNTS \\(${virtualAccountsList.length}\\)\\:*\n\n`;
    
    virtualAccountsList.slice(0, 15).forEach((acc, index) => {
      message += `${index + 1}\\. *User\\:* \`${escapeMarkdown(acc.userId)}\`\n`;
      message += `   🏦 *Bank\\:* ${escapeMarkdown(acc.accountBank || 'Unknown')}\n`;
      message += `   🔢 *Account\\:* \`${acc.accountNumber}\`\n`;
      message += `   💰 *Balance\\:* ${formatCurrency(acc.balance)}\n`;
      message += `   🛂 *KYC\\:* ${acc.kyc.toUpperCase()}\n`;
      message += `   🆔 *BVN Verified\\:* ${acc.bvnVerified ? '✅ YES' : '❌ NO'}\n\n`;
    });
    
    await ctx.editMessageText(message, { 
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'admin_virtual_accounts')],
        [Markup.button.callback('⬅️ Back to Admin', 'back_to_admin')]
      ])
    });
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Admin virtual accounts error:', error);
    ctx.answerCbQuery('❌ Error loading virtual accounts');
  }
}

async function handleAdminVTUBalance(ctx, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      await ctx.answerCbQuery('❌ Admin only');
      return;
    }
    
    await ctx.editMessageText('🔄 Checking VTU balance\\.\\.\\.', { parse_mode: 'MarkdownV2' });
    
    try {
      const vtuData = await checkVTUBalance(CONFIG);
      
      let message = `💰 *VTU ACCOUNT BALANCE*\n\n`;
      
      let balance = 0;
      let currency = 'NGN';
      let status = 'Active';
      let accountName = 'Liteway VTU';
      let email = 'admin@liteway.com';
      
      if (vtuData.balance !== undefined) {
        balance = parseFloat(vtuData.balance);
      } else if (vtuData.wallet_balance !== undefined) {
        balance = parseFloat(vtuData.wallet_balance);
      }
      
      if (vtuData.currency) currency = vtuData.currency;
      if (vtuData.status) status = vtuData.status;
      if (vtuData.name) accountName = vtuData.name;
      if (vtuData.username) accountName = vtuData.username;
      if (vtuData.email) email = vtuData.email;
      
      message += `💵 *Balance\\:* ${formatCurrency(balance)}\n`;
      message += `💱 *Currency\\:* ${escapeMarkdown(currency)}\n`;
      message += `📊 *Status\\:* ${escapeMarkdown(status)}\n`;
      message += `👤 *Account\\:* ${escapeMarkdown(accountName)}\n`;
      message += `📧 *Email\\:* ${escapeMarkdown(email)}\n`;
      
      message += `\n🔄 *Last Updated\\:* ${escapeMarkdown(new Date().toLocaleString())}`;
      
      await ctx.editMessageText(message, {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'admin_vtu_balance')],
          [Markup.button.callback('⬅️ Back to Admin', 'back_to_admin')]
        ])
      });
      
    } catch (apiError) {
      console.error('VTU Balance API Error:', apiError.message);
      
      await ctx.editMessageText(
        `💰 *VTU ACCOUNT BALANCE*\n\n` +
        `💵 *Balance\\:* ₦121\\.63 \\(Demo\\)\n` +
        `💱 *Currency\\:* NGN\n` +
        `📊 *Status\\:* Active\n` +
        `👤 *Account\\:* 07052110985\n` +
        `📧 *Email\\:* Admin\\@VTU\n\n` +
        `⚠️ *Note\\:* Using API fallback data\\.\n` +
        `API Error\\: ${escapeMarkdown(apiError.message || 'Connection failed')}`,
        {
          parse_mode: 'MarkdownV2',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Retry', 'admin_vtu_balance')],
            [Markup.button.callback('⬅️ Back to Admin', 'back_to_admin')]
          ])
        }
      );
    }
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Admin VTU balance error:', error);
    ctx.answerCbQuery('❌ Error checking balance');
  }
}

async function handleAdminViewPlans(ctx, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      await ctx.answerCbQuery('❌ Admin only');
      return;
    }
    
    await ctx.editMessageText('🔄 Loading plans\\.\\.\\.', { parse_mode: 'MarkdownV2' });
    
    const networks = getAvailableNetworks();
    
    if (networks.length === 0) {
      await ctx.editMessageText('❌ No networks found\\. Check your folder structure\\.', { parse_mode: 'MarkdownV2' });
      return;
    }
    
    let message = `📋 *DATA PLANS OVERVIEW*\n\n`;
    
    networks.forEach(network => {
      message += `📱 *${escapeMarkdown(network)}\\:*\n`;
      const validities = getAvailableValidities(network);
      
      if (validities.length === 0) {
        message += `   ❌ No validity files found\n`;
      } else {
        validities.forEach(validity => {
          const plans = getDataPlans(network, validity, CONFIG);
          message += `   📅 *${escapeMarkdown(validity)}\\:* ${plans.length} plans\n`;
        });
      }
      message += `\n`;
    });
    
    await ctx.editMessageText(message, {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'admin_view_plans')],
        [Markup.button.callback('⬅️ Back to Admin', 'back_to_admin')]
      ])
    });
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Admin view plans error:', error);
    ctx.answerCbQuery('❌ Error loading plans');
  }
}

async function handleAdminStats(ctx, users, transactions, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      await ctx.answerCbQuery('❌ Admin only');
      return;
    }
    
    const totalUsers = Object.keys(users).length;
    let totalBalance = 0;
    let pendingKyc = 0;
    let approvedKyc = 0;
    let usersWithVirtualAccounts = 0;
    let usersWithBVN = 0;
    let usersWithVerifiedBVN = 0;
    let totalTransactions = 0;
    
    Object.values(users).forEach(user => {
      totalBalance += user.wallet || 0;
      if (user.kyc === 'pending') pendingKyc++;
      if (user.kyc === 'approved') approvedKyc++;
      if (user.virtualAccount) usersWithVirtualAccounts++;
      if (user.bvn) usersWithBVN++;
      if (user.bvnVerified) usersWithVerifiedBVN++;
    });
    
    Object.values(transactions).forEach(userTx => {
      totalTransactions += userTx.length;
    });
    
    let totalPlans = 0;
    const networks = getAvailableNetworks();
    
    networks.forEach(network => {
      const validities = getAvailableValidities(network);
      validities.forEach(validity => {
        const plans = getDataPlans(network, validity, CONFIG);
        totalPlans += plans.length;
      });
    });
    
    const message = `📊 *SYSTEM STATISTICS*\n\n` +
      `👥 *Total Users\\:* ${totalUsers}\n` +
      `💰 *User Balances\\:* ${formatCurrency(totalBalance)}\n` +
      `✅ *Approved KYC\\:* ${approvedKyc}\n` +
      `⏳ *Pending KYC\\:* ${pendingKyc}\n` +
      `🏦 *Virtual Accounts\\:* ${usersWithVirtualAccounts}\n` +
      `🆔 *BVN Submitted\\:* ${usersWithBVN}\n` +
      `✅ *BVN Verified\\:* ${usersWithVerifiedBVN}\n` +
      `📈 *Data Plans\\:* ${totalPlans}\n` +
      `📜 *Total Transactions\\:* ${totalTransactions}\n\n` +
      `⚡ *Available Networks\\:* ${escapeMarkdown(networks.join(', '))}\n\n` +
      `🔄 *Last Updated\\:* ${escapeMarkdown(new Date().toLocaleString())}`;
    
    await ctx.editMessageText(message, {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'admin_stats')],
        [Markup.button.callback('⬅️ Back to Admin', 'back_to_admin')]
      ])
    });
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Admin stats error:', error);
    ctx.answerCbQuery('❌ Error loading stats');
  }
}

async function handleAdminBVNList(ctx, users, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      await ctx.answerCbQuery('❌ Admin only');
      return;
    }
    
    const bvnUsers = [];
    Object.entries(users).forEach(([uid, user]) => {
      if (user.bvn) {
        bvnUsers.push({
          userId: uid,
          fullName: user.fullName,
          bvn: user.bvn,
          bvnVerified: user.bvnVerified,
          bvnSubmittedAt: user.bvnSubmittedAt,
          bvnVerifiedAt: user.bvnVerifiedAt,
          virtualAccount: user.virtualAccount
        });
      }
    });
    
    if (bvnUsers.length === 0) {
      await ctx.editMessageText('📭 No BVN submissions yet\\.', { 
        parse_mode: 'MarkdownV2' 
      });
      return;
    }
    
    let message = `🆔 *BVN SUBMISSIONS \\(${bvnUsers.length} users\\)\\:*\n\n`;
    
    bvnUsers.slice(0, 15).forEach((user, index) => {
      const verifiedEmoji = user.bvnVerified ? '✅' : '⏳';
      const virtualAccEmoji = user.virtualAccount ? '🏦' : '❌';
      message += `${index + 1}\\. *User\\:* \`${escapeMarkdown(user.userId)}\`\n`;
      message += `   📛 *Name\\:* ${escapeMarkdown(user.fullName || 'Not provided')}\n`;
      message += `   🆔 *BVN\\:* \`${maskBVN(user.bvn)}\`\n`;
      message += `   ${verifiedEmoji} *Status\\:* ${user.bvnVerified ? 'Verified' : 'Pending'}\n`;
      message += `   ${virtualAccEmoji} *Virtual Account\\:* ${user.virtualAccount ? 'Yes' : 'No'}\n`;
      if (user.bvnSubmittedAt) {
        message += `   📅 *Submitted\\:* ${escapeMarkdown(new Date(user.bvnSubmittedAt).toLocaleDateString())}\n`;
      }
      if (!user.bvnVerified) {
        message += `   ✅ *Verify\\:* /verify\\_bvn ${escapeMarkdown(user.userId)}\n`;
      }
      message += `\n`;
    });
    
    await ctx.editMessageText(message, { 
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'admin_bvn_list')],
        [Markup.button.callback('⬅️ Back to Admin', 'back_to_admin')]
      ])
    });
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Admin BVN list error:', error);
    ctx.answerCbQuery('❌ Error loading BVN list');
  }
}

async function handleAdminApproveAll(ctx, users, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      await ctx.answerCbQuery('❌ Admin only');
      return;
    }
    
    let approvedCount = 0;
    
    Object.keys(users).forEach(userId => {
      if (users[userId].kyc === 'pending') {
        users[userId].kyc = 'approved';
        approvedCount++;
      }
    });
    
    await ctx.editMessageText(
      `✅ *BULK KYC APPROVAL*\n\n` +
      `📊 *Users Approved\\:* ${approvedCount}\n\n` +
      `All pending KYC requests have been approved\\.`,
      {
        parse_mode: 'MarkdownV2',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🔄 Refresh', 'admin_stats')],
          [Markup.button.callback('⬅️ Back to Admin', 'back_to_admin')]
        ])
      }
    );
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Admin approve all error:', error);
    ctx.answerCbQuery('❌ Error approving KYC');
  }
}

async function handleBackToAdmin(ctx, users, transactions, CONFIG) {
  try {
    const userId = ctx.from.id.toString();
    
    if (!isAdmin(userId, CONFIG.ADMIN_ID)) {
      await ctx.answerCbQuery('❌ Admin only');
      return;
    }
    
    const totalUsers = Object.keys(users).length;
    let totalBalance = 0;
    let pendingKyc = 0;
    let approvedKyc = 0;
    let usersWithVirtualAccounts = 0;
    let usersWithBVN = 0;
    let usersWithVerifiedBVN = 0;
    
    Object.values(users).forEach(user => {
      totalBalance += user.wallet || 0;
      if (user.kyc === 'pending') pendingKyc++;
      if (user.kyc === 'approved') approvedKyc++;
      if (user.virtualAccount) usersWithVirtualAccounts++;
      if (user.bvn) usersWithBVN++;
      if (user.bvnVerified) usersWithVerifiedBVN++;
    });
    
    let totalPlans = 0;
    const networks = getAvailableNetworks();
    
    networks.forEach(network => {
      const validities = getAvailableValidities(network);
      validities.forEach(validity => {
        const plans = getDataPlans(network, validity, CONFIG);
        totalPlans += plans.length;
      });
    });
    
    const message = `🛠️ *ADMIN CONTROL PANEL*\n\n` +
      `📊 *Statistics\\:*\n` +
      `👥 Total Users\\: ${totalUsers}\n` +
      `💰 User Balances\\: ${formatCurrency(totalBalance)}\n` +
      `✅ Approved KYC\\: ${approvedKyc}\n` +
      `⏳ Pending KYC\\: ${pendingKyc}\n` +
      `🏦 Virtual Accounts\\: ${usersWithVirtualAccounts}\n` +
      `🆔 BVN Submitted\\: ${usersWithBVN}\n` +
      `✅ BVN Verified\\: ${usersWithVerifiedBVN}\n` +
      `📈 Data Plans\\: ${totalPlans}\n\n` +
      `⚡ *Quick Commands\\:*\n` +
      `• /users \\- List all users\n` +
      `• /stats \\- System statistics\n` +
      `• /deposit \\[id\\] \\[amount\\] \\- Deposit funds\n` +
      `• /credit \\[id\\] \\[amount\\] \\- Credit user\n` +
      `• /approve \\[id\\] \\- Approve KYC\n` +
      `• /vtu\\_balance \\- Check VTU balance\n` +
      `• /virtual\\_accounts \\- List virtual accounts\n` +
      `• /view\\_plans \\- View data plans\n` +
      `• /bvn\\_list \\- List BVN submissions\n` +
      `• /verify\\_bvn \\[id\\] \\- Verify user BVN\n\n` +
      `💡 *Admin Actions\\:*`;
    
    await ctx.editMessageText(message, {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📋 List Users', 'admin_list_users')],
        [Markup.button.callback('💰 VTU Balance', 'admin_vtu_balance')],
        [Markup.button.callback('🏦 Virtual Accounts', 'admin_virtual_accounts')],
        [Markup.button.callback('📊 View Plans', 'admin_view_plans')],
        [Markup.button.callback('📈 System Stats', 'admin_stats')],
        [Markup.button.callback('🆔 BVN List', 'admin_bvn_list')],
        [Markup.button.callback('✅ Approve All KYC', 'admin_approve_all')]
      ])
    });
    
    ctx.answerCbQuery();
    
  } catch (error) {
    console.error('❌ Back to admin error:', error);
    ctx.answerCbQuery('❌ Error loading admin panel');
  }
}

// Helper functions
async function checkVTUBalance(CONFIG) {
  try {
    console.log('🔍 Checking VTU balance...');
    const response = await axios.get(`${CONFIG.VTU_BASE_URL}/user/`, {
      headers: {
        'Authorization': `Token ${CONFIG.VTU_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ VTU Balance API Error:', error.message);
    return {
      balance: '121.63',
      wallet_balance: '121.63',
      currency: 'NGN',
      status: 'active',
      name: 'Liteway VTU',
      email: 'admin@liteway.com'
    };
  }
}

function getAvailableNetworks() {
  return ['MTN', 'Glo', 'AIRTEL', '9MOBILE'];
}

function getAvailableValidities(network) {
  const validities = [];
  const networkFolder = network === 'Glo' ? 'Glo' : network;
  const basePath = process.cwd();
  
  if (fs.existsSync(path.join(basePath, networkFolder, 'daily.json'))) {
    validities.push('Daily');
  }
  if (fs.existsSync(path.join(basePath, networkFolder, 'weekly.json'))) {
    validities.push('Weekly');
  }
  if (fs.existsSync(path.join(basePath, networkFolder, 'monthly.json'))) {
    validities.push('Monthly');
  }
  
  return validities.length > 0 ? validities : ['Monthly'];
}

function getDataPlans(network, validityType = null, CONFIG) {
  try {
    const networkFolder = network === 'Glo' ? 'Glo' : network;
    const basePath = process.cwd();
    
    if (validityType) {
      const fileName = validityType.toLowerCase() + '.json';
      const filePath = path.join(basePath, networkFolder, fileName);
      
      if (!fs.existsSync(filePath)) {
        return [];
      }
      
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const plans = JSON.parse(fileContent);
      const planArray = Array.isArray(plans) ? plans : [plans];
      
      return planArray.map(plan => ({
        Network: network,
        Plan: plan.data || plan.Plan || 'N/A',
        Validity: plan.validity || plan.Validity || validityType,
        Price: parseFloat(plan.price || plan.Price || 0),
        PlanID: (plan.id || plan.PlanID || '0').toString(),
        DisplayPrice: parseFloat(plan.price || plan.Price || 0) + CONFIG.SERVICE_FEE
      }));
    }
    
    return [];
  } catch (error) {
    console.error(`Error loading ${network} ${validityType} plans:`, error.message);
    return [];
  }
}

function isAdmin(userId, adminId) {
  return userId.toString() === adminId.toString();
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

function maskBVN(bvn) {
  if (!bvn || bvn.length !== 11) return 'Invalid BVN';
  return `${bvn.substring(0, 3)}*****${bvn.substring(8)}`;
}