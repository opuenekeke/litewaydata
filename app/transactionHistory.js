// app/transactionHistory.js
module.exports = {
  handleHistory: async (ctx, users, transactions, CONFIG) => {
    try {
      const userId = ctx.from.id.toString();
      const userTransactions = transactions[userId] || [];
      
      if (userTransactions.length === 0) {
        return await ctx.reply(
          `📭 *NO TRANSACTIONS YET*\n\n` +
          `💡 *Get started\\:*\n` +
          `1\\. Get KYC approved\n` +
          `2\\. Deposit funds\n` +
          `3\\. Start buying airtime/data`,
          { parse_mode: 'MarkdownV2' }
        );
      }
      
      let message = `📜 *TRANSACTION HISTORY*\n\n`;
      
      userTransactions.slice(-10).reverse().forEach((tx, index) => {
        const emoji = tx.status === 'success' ? '✅' : '❌';
        const typeEmoji = tx.type === 'airtime' ? '📞' : 
                         tx.type === 'data' ? '📡' : 
                         tx.type === 'credit' || tx.type === 'deposit' ? '💰' : 
                         tx.type === 'transfer' ? '💸' : 
                         tx.type === 'bank_transfer' ? '🏦' : '💳';
        
        message += `${emoji} *${escapeMarkdown(tx.type?.toUpperCase() || 'Unknown')}*\n`;
        message += `   ${typeEmoji} Amount\\: ${formatCurrency(tx.amount || 0)}\n`;
        if (tx.network) message += `   📱 Network\\: ${escapeMarkdown(tx.network)}\n`;
        if (tx.plan) message += `   📊 Plan\\: ${escapeMarkdown(tx.plan)}\n`;
        if (tx.reference) message += `   🔢 Ref\\: ${escapeMarkdown(tx.reference.substring(0, 12))}\\.\\.\\.\n`;
        message += `   ⏰ Date\\: ${escapeMarkdown(tx.date)}\n`;
        if (tx.status === 'failed' && tx.reason) {
          message += `   ⚠️ Reason\\: ${escapeMarkdown(tx.reason.substring(0, 30))}\\.\\.\\.\n`;
        }
        message += `\n`;
      });
      
      message += `📊 *Total Transactions\\:* ${userTransactions.length}`;
      
      await ctx.reply(message, { parse_mode: 'MarkdownV2' });
      
    } catch (error) {
      console.error('❌ History error:', error);
    }
  }
};

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