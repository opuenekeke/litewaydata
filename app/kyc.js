/**
 * kyc.js - KYC Verification Module
 */

const { Markup } = require('telegraf');

async function handleKyc(ctx, users) {
  try {
    const userId = ctx.from.id.toString();
    const user = users[userId] || { kycStatus: 'pending' };
    
    const kycStatus = user.kycStatus || 'pending';
    
    let statusMessage = '';
    let keyboard = [];
    
    switch (kycStatus) {
      case 'pending':
        statusMessage = 
          `🛂 *KYC STATUS: PENDING*\n\n` +
          `📋 *Requirements:*\n` +
          `• Valid ID Card\n` +
          `• Selfie with ID\n` +
          `• Proof of Address\n\n` +
          `📝 *To get verified:*\n` +
          `1. Send photos of documents to @opuenekeke\n` +
          `2. Include your User ID: \`${userId}\`\n` +
          `3. Wait for approval (24-48 hours)\n\n` +
          `⚠️ *Note:* KYC is required for deposits and transfers.`;
        
        keyboard = [
          [Markup.button.callback('✅ I have sent documents', 'kyc_submitted')],
          [Markup.button.callback('🏠 Home', 'start')]
        ];
        break;
        
      case 'submitted':
        statusMessage = 
          `⏳ *KYC STATUS: SUBMITTED*\n\n` +
          `✅ Your documents have been submitted.\n` +
          `⏰ Processing time: 24-48 hours\n\n` +
          `📞 Contact @opuenekeke for updates.`;
        
        keyboard = [
          [Markup.button.callback('🔄 Check Status', 'kyc_check')],
          [Markup.button.callback('🏠 Home', 'start')]
        ];
        break;
        
      case 'approved':
        statusMessage = 
          `✅ *KYC STATUS: APPROVED*\n\n` +
          `🎉 Your account is fully verified!\n` +
          `✅ You can now:\n` +
          `• Deposit funds\n` +
          `• Transfer to banks\n` +
          `• Use all services\n\n` +
          `📅 Verified on: ${user.kycApprovedDate || 'Recent'}`;
        
        keyboard = [
          [Markup.button.callback('🏠 Home', 'start')]
        ];
        break;
        
      case 'rejected':
        statusMessage = 
          `❌ *KYC STATUS: REJECTED*\n\n` +
          `Reason: ${user.kycRejectionReason || 'Document issues'}\n\n` +
          `📝 *Next steps:*\n` +
          `1. Check document quality\n` +
          `2. Resend clear photos\n` +
          `3. Contact @opuenekeke\n\n` +
          `🔄 *Resubmit documents:*`;
        
        keyboard = [
          [Markup.button.callback('🔄 Resubmit KYC', 'kyc_resubmit')],
          [Markup.button.callback('🏠 Home', 'start')]
        ];
        break;
        
      default:
        statusMessage = `❌ KYC status unknown. Please contact admin.`;
        keyboard = [[Markup.button.callback('🏠 Home', 'start')]];
    }
    
    await ctx.reply(statusMessage, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(keyboard)
    });
    
  } catch (error) {
    console.error('❌ KYC error:', error);
    await ctx.reply('❌ An error occurred. Please try again.');
  }
}

function getCallbacks(bot, users) {
  return {
    'kyc_submitted': async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        if (!users[userId]) {
          return ctx.answerCbQuery('User not found');
        }
        
        users[userId].kycStatus = 'submitted';
        users[userId].kycSubmittedDate = new Date().toISOString();
        
        await ctx.editMessageText(
          `✅ *KYC SUBMITTED*\n\n` +
          `Your documents have been marked as submitted.\n\n` +
          `⏰ *Processing:* 24-48 hours\n` +
          `📞 *Contact:* @opuenekeke for updates\n\n` +
          `🔢 *Your User ID:* \`${userId}\``,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('🏠 Home', 'start')]
            ])
          }
        );
        
        ctx.answerCbQuery();
        
      } catch (error) {
        console.error('KYC submitted error:', error);
        ctx.answerCbQuery('❌ Error occurred');
      }
    },
    
    'kyc_check': async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        const user = users[userId];
        
        if (!user) {
          return ctx.answerCbQuery('User not found');
        }
        
        let status = user.kycStatus || 'pending';
        let message = '';
        
        if (status === 'submitted') {
          const submittedDate = user.kycSubmittedDate ? new Date(user.kycSubmittedDate) : new Date();
          const hoursAgo = Math.floor((new Date() - submittedDate) / (1000 * 60 * 60));
          
          message = 
            `🔄 *KYC STATUS CHECK*\n\n` +
            `📅 Submitted: ${submittedDate.toLocaleDateString()}\n` +
            `⏰ ${hoursAgo} hours ago\n` +
            `⏳ Still processing...\n\n` +
            `📞 Contact @opuenekeke for updates.`;
        } else {
          message = `Current status: ${status.toUpperCase()}`;
        }
        
        await ctx.editMessageText(message, {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Refresh', 'kyc_check')],
            [Markup.button.callback('🏠 Home', 'start')]
          ])
        });
        
        ctx.answerCbQuery();
        
      } catch (error) {
        console.error('KYC check error:', error);
        ctx.answerCbQuery('❌ Error occurred');
      }
    },
    
    'kyc_resubmit': async (ctx) => {
      try {
        const userId = ctx.from.id.toString();
        if (!users[userId]) {
          return ctx.answerCbQuery('User not found');
        }
        
        users[userId].kycStatus = 'pending';
        delete users[userId].kycRejectionReason;
        
        await ctx.editMessageText(
          `🔄 *KYC RESUBMISSION*\n\n` +
          `Your KYC status has been reset to pending.\n\n` +
          `📝 *Resubmit documents to:* @opuenekeke\n` +
          `🔢 *Your User ID:* \`${userId}\`\n\n` +
          `📋 *Required documents:*\n` +
          `• Valid ID Card\n` +
          `• Selfie with ID\n` +
          `• Proof of Address`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✅ Mark as Submitted', 'kyc_submitted')],
              [Markup.button.callback('🏠 Home', 'start')]
            ])
          }
        );
        
        ctx.answerCbQuery();
        
      } catch (error) {
        console.error('KYC resubmit error:', error);
        ctx.answerCbQuery('❌ Error occurred');
      }
    }
  };
}

// Admin function to approve/reject KYC
function approveKyc(userId, users, reason = '') {
  if (!users[userId]) {
    return { success: false, error: 'User not found' };
  }
  
  users[userId].kycStatus = 'approved';
  users[userId].kycApprovedDate = new Date().toISOString();
  
  return { success: true, message: 'KYC approved' };
}

function rejectKyc(userId, users, reason = 'Document issues') {
  if (!users[userId]) {
    return { success: false, error: 'User not found' };
  }
  
  users[userId].kycStatus = 'rejected';
  users[userId].kycRejectionReason = reason;
  users[userId].kycRejectedDate = new Date().toISOString();
  
  return { success: true, message: 'KYC rejected' };
}

module.exports = {
  handleKyc,
  getCallbacks,
  approveKyc,
  rejectKyc
};