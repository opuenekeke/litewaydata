// scripts/backup.js
require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { connectMongoDB } = require('../config/database');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const VirtualAccount = require('../models/VirtualAccount');

async function backupDatabase() {
  try {
    console.log('💾 Starting database backup...');
    
    await connectMongoDB();
    
    const backupDir = path.join(__dirname, '../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `backup-${timestamp}.json`);
    
    // Fetch all data
    const [users, transactions, virtualAccounts] = await Promise.all([
      User.find({}).lean(),
      Transaction.find({}).lean(),
      VirtualAccount.find({}).lean()
    ]);
    
    const backupData = {
      timestamp: new Date().toISOString(),
      users,
      transactions,
      virtualAccounts
    };
    
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    
    console.log(`✅ Backup completed: ${backupFile}`);
    console.log(`📊 Statistics:`);
    console.log(`   👤 Users: ${users.length}`);
    console.log(`   📜 Transactions: ${transactions.length}`);
    console.log(`   🏦 Virtual Accounts: ${virtualAccounts.length}`);
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Backup failed:', error);
    process.exit(1);
  }
}

backupDatabase();