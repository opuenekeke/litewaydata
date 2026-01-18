// scripts/migrate.js
require('dotenv').config();
const mongoose = require('mongoose');
const { connectMongoDB } = require('../config/database');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// Your in-memory data (from original code)
const users = {}; // Your original users object
const transactions = {}; // Your original transactions object

async function migrateData() {
  try {
    console.log('🔄 Starting database migration...');
    
    await connectMongoDB();
    
    // Migrate users
    console.log('👤 Migrating users...');
    const userIds = Object.keys(users);
    
    for (const userId of userIds) {
      const userData = users[userId];
      
      // Transform to match schema
      const user = new User({
        telegramId: userId,
        wallet: userData.wallet || 0,
        kyc: userData.kyc || 'pending',
        pin: userData.pin || null,
        pinAttempts: userData.pinAttempts || 0,
        pinLocked: userData.pinLocked || false,
        email: userData.email || null,
        phone: userData.phone || null,
        fullName: userData.fullName || null,
        bvn: userData.bvn || null,
        virtualAccount: userData.virtualAccount || null,
        virtualAccountNumber: userData.virtualAccountNumber || null,
        virtualAccountBank: userData.virtualAccountBank || null,
        dailyDeposit: userData.dailyDeposit || 0,
        dailyTransfer: userData.dailyTransfer || 0,
        lastDeposit: userData.lastDeposit ? new Date(userData.lastDeposit) : null,
        lastTransfer: userData.lastTransfer ? new Date(userData.lastTransfer) : null,
        joined: userData.joined ? new Date(userData.joined) : new Date()
      });
      
      await user.save();
      console.log(`✅ Migrated user: ${userId}`);
    }
    
    // Migrate transactions
    console.log('📜 Migrating transactions...');
    for (const userId of userIds) {
      const userTransactions = transactions[userId] || [];
      
      for (const tx of userTransactions) {
        const transaction = new Transaction({
          userId: userId,
          type: tx.type || 'unknown',
          amount: tx.amount || 0,
          network: tx.network || null,
          plan: tx.plan || null,
          phone: tx.phone || null,
          recipientAccount: tx.recipientAccount || null,
          recipientName: tx.recipientName || null,
          recipientBank: tx.recipientBank || null,
          fee: tx.fee || 0,
          totalAmount: tx.totalAmount || tx.amount || 0,
          status: tx.status || 'pending',
          reference: tx.reference || `MIG${Date.now()}_${userId}`,
          apiReference: tx.api_reference || null,
          apiResponse: tx.api_response || null,
          reason: tx.reason || null,
          source: tx.source || null,
          paymentMethod: tx.paymentMethod || null,
          payerName: tx.payerName || null,
          payerEmail: tx.payerEmail || null,
          description: tx.description || null,
          admin: tx.admin || null,
          metadata: tx.metadata || {},
          timestamp: tx.timestamp ? new Date(tx.timestamp) : new Date()
        });
        
        await transaction.save();
      }
      
      console.log(`✅ Migrated ${userTransactions.length} transactions for user: ${userId}`);
    }
    
    console.log('🎉 Migration completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateData();