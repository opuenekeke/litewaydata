const axios = require('axios');
const https = require('https');
const { Markup } = require('telegraf');

/* ---------------------------------------------------
   Helpers
--------------------------------------------------- */

const formatCurrency = amt =>
  `₦${Number(amt || 0).toLocaleString('en-NG')}`;

const isValidEmail = email =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');

const escapeMD = text =>
  text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');

/* ---------------------------------------------------
   Billstack Core Config
--------------------------------------------------- */

const BASE_URL = process.env.BILLSTACK_BASE_URL || 'https://api.billstack.io';
const SECRET_KEY = process.env.BILLSTACK_SECRET_KEY;

if (!SECRET_KEY) {
  console.error('❌ BILLSTACK_SECRET_KEY not set');
}

const httpsAgent = new https.Agent({ keepAlive: false });

let cachedToken = null;
let tokenExpiry = 0;

/* ---------------------------------------------------
   Billstack Auth
--------------------------------------------------- */

async function getBillstackToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiry > now) return cachedToken;

  const res = await axios.post(
    `${BASE_URL}/v1/auth/token`,
    {},
    {
      headers: {
        Authorization: `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      httpsAgent,
      timeout: 20000
    }
  );

  if (!res.data?.data?.access_token) {
    throw new Error('Invalid Billstack token response');
  }

  cachedToken = res.data.data.access_token;
  tokenExpiry = now + 55 * 60 * 1000; // 55 mins

  return cachedToken;
}

/* ---------------------------------------------------
   Virtual Account
--------------------------------------------------- */

async function createVirtualAccount(userId, user, virtualAccounts) {
  const token = await getBillstackToken();

  const payload = {
    customer_name: user.fullName || `User ${userId}`,
    customer_email: user.email,
    customer_phone: user.phone || `+234${userId.slice(0, 10)}`,
    account_reference: `VTU_${userId}_${Date.now()}`,
    currency: 'NGN'
  };

  const res = await axios.post(
    `${BASE_URL}/v1/virtual-accounts`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      httpsAgent,
      timeout: 30000
    }
  );

  if (!res.data?.data) {
    throw new Error(res.data?.message || 'VA creation failed');
  }

  const d = res.data.data;

  const account = {
    provider: 'billstack',
    accountReference: payload.account_reference,
    accountNumber: d.account_number,
    accountName: d.account_name,
    bankName: d.bank_name || 'WEMA BANK',
    bankCode: d.bank_code || '035',
    created: new Date().toISOString(),
    active: true
  };

  virtualAccounts[userId] = account;
  user.virtualAccount = account.accountReference;

  return account;
}

/* ---------------------------------------------------
   Deposit Handler
--------------------------------------------------- */

async function handleDeposit(ctx, users, virtualAccounts, sessions) {
  const userId = ctx.from.id.toString();
  const user = users[userId] ||= {
    wallet: 0,
    email: null,
    kyc: 'pending',
    fullName: ctx.from.first_name || `User ${userId}`
  };

  if (user.kyc !== 'approved') {
    return ctx.reply('❌ KYC approval required.');
  }

  if (!isValidEmail(user.email)) {
    sessions[userId] = { action: 'email' };
    return ctx.reply('📧 Please send your email address.');
  }

  let account = virtualAccounts[userId];
  if (!account) {
    await ctx.reply('⏳ Creating your virtual account...');
    account = await createVirtualAccount(userId, user, virtualAccounts);
  }

  await ctx.reply(
    `💰 *YOUR VIRTUAL ACCOUNT*\n\n` +
    `🏦 ${account.bankName}\n` +
    `🔢 \`${account.accountNumber}\`\n` +
    `📛 ${escapeMD(account.accountName)}\n\n` +
    `Transfer funds to this account.`,
    { parse_mode: 'MarkdownV2' }
  );
}

/* ---------------------------------------------------
   Webhook
--------------------------------------------------- */

function handleBillstackWebhook(bot, users, transactions, virtualAccounts) {
  return async (req, res) => {
    try {
      const data = req.body?.data;
      if (!data?.amount || !data?.account_number) {
        return res.sendStatus(200);
      }

      const amount = Number(data.amount);
      const accNo = data.account_number;

      const userId = Object.keys(virtualAccounts)
        .find(id => virtualAccounts[id].accountNumber === accNo);

      if (!userId) return res.sendStatus(200);

      const user = users[userId];
      user.wallet += amount;

      transactions[userId] ||= [];
      transactions[userId].push({
        type: 'deposit',
        amount,
        ref: data.reference,
        date: new Date().toISOString()
      });

      await bot.telegram.sendMessage(
        userId,
        `✅ Deposit received\nAmount: ${formatCurrency(amount)}`
      );

      res.sendStatus(200);
    } catch (e) {
      console.error('Webhook error:', e.message);
      res.sendStatus(200);
    }
  };
}

/* ---------------------------------------------------
   Exports
--------------------------------------------------- */

module.exports = {
  handleDeposit,
  handleBillstackWebhook
};
