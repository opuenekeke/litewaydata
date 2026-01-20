// app/sendmoney.js
const axios = require('axios');
const { Markup } = require('telegraf');

/* ===================== CONFIG ===================== */
const CONFIG = {
  MONNIFY_API_KEY: process.env.MONNIFY_API_KEY,
  MONNIFY_SECRET_KEY: process.env.MONNIFY_SECRET_KEY,
  MONNIFY_CONTRACT_CODE: process.env.MONNIFY_CONTRACT_CODE,
  MONNIFY_BASE_URL: process.env.MONNIFY_BASE_URL || 'https://api.monnify.com',

  TRANSFER_FEE_PERCENTAGE: 1.5,
  MIN_TRANSFER_AMOUNT: 100,
  MAX_TRANSFER_AMOUNT: 1000000
};

/* ===================== SESSION MANAGER ===================== */
const sessionManager = {
  sessions: {},

  start(userId) {
    this.sessions[userId] = {
      action: 'bank_transfer',
      step: 1,
      data: {},
      createdAt: Date.now()
    };
  },

  get(userId) {
    return this.sessions[userId] || null;
  },

  update(userId, step, data = {}) {
    if (!this.sessions[userId]) return;
    this.sessions[userId].step = step;
    Object.assign(this.sessions[userId].data, data);
  },

  clear(userId) {
    delete this.sessions[userId];
  }
};

/* ===================== HELPERS ===================== */
const formatCurrency = amt =>
  `₦${Number(amt).toLocaleString('en-NG')}`;

const escapeMarkdown = txt =>
  typeof txt === 'string'
    ? txt.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
    : txt;

const isConfigured = () =>
  CONFIG.MONNIFY_API_KEY &&
  CONFIG.MONNIFY_SECRET_KEY &&
  CONFIG.MONNIFY_CONTRACT_CODE;

/* ===================== MONNIFY ===================== */
async function getMonnifyToken() {
  const auth = Buffer.from(
    `${CONFIG.MONNIFY_API_KEY}:${CONFIG.MONNIFY_SECRET_KEY}`
  ).toString('base64');

  const res = await axios.post(
    `${CONFIG.MONNIFY_BASE_URL}/api/v1/auth/login`,
    {},
    {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 15000
    }
  );

  return res.data.responseBody.accessToken;
}

async function getBanks() {
  try {
    const token = await getMonnifyToken();
    const res = await axios.get(
      `${CONFIG.MONNIFY_BASE_URL}/api/v1/banks`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      }
    );
    return res.data.responseBody;
  } catch {
    return [
      { code: '058', name: 'GTBank' },
      { code: '044', name: 'Access Bank' },
      { code: '033', name: 'UBA' },
      { code: '057', name: 'Zenith Bank' },
      { code: '011', name: 'First Bank' },
      { code: '232', name: 'Sterling Bank' }
    ];
  }
}

async function resolveAccount(accountNumber, bankCode) {
  try {
    const token = await getMonnifyToken();
    const res = await axios.get(
      `${CONFIG.MONNIFY_BASE_URL}/api/v1/disbursements/account/validate`,
      {
        params: { accountNumber, bankCode },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
      }
    );
    return { success: true, ...res.data.responseBody };
  } catch (e) {
    return {
      success: false,
      error:
        e.response?.data?.responseMessage ||
        'Account resolution failed'
    };
  }
}

async function initiateTransfer(data) {
  try {
    const token = await getMonnifyToken();

    const payload = {
      amount: data.amount,
      reference: data.reference,
      narration: data.narration,
      destinationBankCode: data.bankCode,
      destinationAccountNumber: data.accountNumber,
      currency: 'NGN',
      contractCode: CONFIG.MONNIFY_CONTRACT_CODE
    };

    const res = await axios.post(
      `${CONFIG.MONNIFY_BASE_URL}/api/v2/disbursements/single`,
      payload,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000
      }
    );

    return { success: true, ...res.data.responseBody };
  } catch (e) {
    return {
      success: false,
      error:
        e.response?.data?.responseMessage ||
        'Transfer failed'
    };
  }
}

/* ===================== START TRANSFER ===================== */
async function handleSendMoney(ctx, users) {
  const userId = ctx.from.id.toString();
  const user = users[userId];

  if (!user) return ctx.reply('❌ Use /start first');

  if (user.pinLocked)
    return ctx.reply('🔒 Account locked. Contact admin.');

  if (user.kycStatus !== 'approved')
    return ctx.reply('❌ KYC verification required');

  if (!user.pin)
    return ctx.reply('❌ Set transaction PIN first');

  if (!isConfigured())
    return ctx.reply('❌ Bank transfer unavailable');

  if (user.wallet < CONFIG.MIN_TRANSFER_AMOUNT)
    return ctx.reply('❌ Insufficient balance');

  sessionManager.start(userId);

  const banks = await getBanks();
  const buttons = [];

  for (let i = 0; i < banks.length; i += 2) {
    buttons.push(
      banks.slice(i, i + 2).map(b =>
        Markup.button.callback(
          `🏦 ${b.name}`,
          `sendmoney_bank_${b.code}`
        )
      )
    );
  }

  buttons.push([
    Markup.button.callback('❌ Cancel', 'start')
  ]);

  await ctx.reply(
    `🏦 *Select Bank*\n\n💰 Balance: ${formatCurrency(
      user.wallet
    )}`,
    {
      parse_mode: 'MarkdownV2',
      ...Markup.inlineKeyboard(buttons)
    }
  );
}

/* ===================== CALLBACKS ===================== */
function getCallbacks(users) {
  return {
    bank: async ctx => {
      const userId = ctx.from.id.toString();
      const bankCode = ctx.match[1];
      const session = sessionManager.get(userId);

      if (!session || session.action !== 'bank_transfer')
        return ctx.answerCbQuery('Session expired');

      const banks = await getBanks();
      const bank = banks.find(b => b.code === bankCode);

      sessionManager.update(userId, 2, {
        bankCode,
        bankName: bank?.name || 'Unknown Bank'
      });

      await ctx.editMessageText(
        `🏦 *${escapeMarkdown(
          bank?.name || 'Bank'
        )}*\n\nEnter *10-digit* account number:`,
        { parse_mode: 'MarkdownV2' }
      );
    }
  };
}

/* ===================== TEXT HANDLER ===================== */
async function handleText(ctx, text, users) {
  const userId = ctx.from.id.toString();
  const session = sessionManager.get(userId);
  if (!session || session.action !== 'bank_transfer')
    return false;

  const user = users[userId];

  /* STEP 2 — ACCOUNT NUMBER */
  if (session.step === 2) {
    if (!/^\d{10}$/.test(text))
      return ctx.reply('❌ Invalid account number');

    sessionManager.update(userId, 3, {
      accountNumber: text
    });

    const res = await resolveAccount(
      text,
      session.data.bankCode
    );

    if (!res.success) {
      sessionManager.update(userId, 4);
      return ctx.reply(
        '⚠️ Could not resolve account.\n\nEnter account name manually:'
      );
    }

    sessionManager.update(userId, 5, {
      accountName: res.accountName
    });

    return ctx.reply(
      `✅ *Account Found*\n\n${escapeMarkdown(
        res.accountName
      )}\n\nEnter amount:`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  /* STEP 4 — MANUAL NAME */
  if (session.step === 4) {
    sessionManager.update(userId, 5, {
      accountName: text
    });
    return ctx.reply('Enter amount:');
  }

  /* STEP 5 — AMOUNT */
  if (session.step === 5) {
    const amount = Number(text);
    if (
      isNaN(amount) ||
      amount < CONFIG.MIN_TRANSFER_AMOUNT ||
      amount > CONFIG.MAX_TRANSFER_AMOUNT
    )
      return ctx.reply('❌ Invalid amount');

    const fee =
      (amount * CONFIG.TRANSFER_FEE_PERCENTAGE) / 100;
    const total = amount + fee;

    if (user.wallet < total) {
      sessionManager.clear(userId);
      return ctx.reply('❌ Insufficient balance');
    }

    sessionManager.update(userId, 6, {
      amount,
      fee,
      total
    });

    return ctx.reply(
      `📋 *Confirm Transfer*\n\nAmount: ${formatCurrency(
        amount
      )}\nFee: ${formatCurrency(
        fee
      )}\n\nEnter PIN:`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  /* STEP 6 — PIN + TRANSFER */
  if (session.step === 6) {
    if (text !== user.pin) {
      user.pinAttempts = (user.pinAttempts || 0) + 1;
      if (user.pinAttempts >= 3)
        user.pinLocked = true;
      return ctx.reply('❌ Wrong PIN');
    }

    user.pinAttempts = 0;

    const ref = `MTR_${Date.now()}_${userId}`;
    const tx = await initiateTransfer({
      amount: session.data.amount,
      bankCode: session.data.bankCode,
      accountNumber: session.data.accountNumber,
      narration: 'Bank Transfer',
      reference: ref
    });

    if (!tx.success) {
      sessionManager.clear(userId);
      return ctx.reply(
        `❌ Transfer failed: ${tx.error}`
      );
    }

    user.wallet -= session.data.total;
    sessionManager.clear(userId);

    return ctx.reply(
      `✅ *Transfer Successful*\n\nNew Balance: ${formatCurrency(
        user.wallet
      )}`,
      { parse_mode: 'MarkdownV2' }
    );
  }

  return false;
}

/* ===================== EXPORT ===================== */
module.exports = {
  handleSendMoney,
  handleText,
  getCallbacks,
  sessionManager
};
