/**
 * database.js - Simple JSON file storage for Render persistence
 */
const fs = require('fs').promises;
const path = require('path');

class Database {
  constructor() {
    this.dataDir = path.join(__dirname, 'data');
    this.usersFile = path.join(this.dataDir, 'users.json');
    this.transactionsFile = path.join(this.dataDir, 'transactions.json');
    this.virtualAccountsFile = path.join(this.dataDir, 'virtualAccounts.json');
    
    this.init();
  }

  async init() {
    try {
      // Create data directory if it doesn't exist
      await fs.mkdir(this.dataDir, { recursive: true });
      
      // Initialize files if they don't exist
      await this.ensureFile(this.usersFile, {});
      await this.ensureFile(this.transactionsFile, {});
      await this.ensureFile(this.virtualAccountsFile, {});
      
      console.log('📁 Database initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization error:', error);
    }
  }

  async ensureFile(filePath, defaultData) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(defaultData, null, 2));
    }
  }

  // User methods
  async getUsers() {
    try {
      const data = await fs.readFile(this.usersFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Error reading users:', error);
      return {};
    }
  }

  async saveUsers(users) {
    try {
      await fs.writeFile(this.usersFile, JSON.stringify(users, null, 2));
    } catch (error) {
      console.error('❌ Error saving users:', error);
    }
  }

  async getUser(userId) {
    const users = await this.getUsers();
    return users[userId] || null;
  }

  async saveUser(userId, userData) {
    const users = await this.getUsers();
    users[userId] = userData;
    await this.saveUsers(users);
    return userData;
  }

  async updateUser(userId, updateData) {
    const users = await this.getUsers();
    if (!users[userId]) {
      users[userId] = {};
    }
    users[userId] = { ...users[userId], ...updateData };
    await this.saveUsers(users);
    return users[userId];
  }

  // Transactions methods
  async getTransactions() {
    try {
      const data = await fs.readFile(this.transactionsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Error reading transactions:', error);
      return {};
    }
  }

  async saveTransactions(transactions) {
    try {
      await fs.writeFile(this.transactionsFile, JSON.stringify(transactions, null, 2));
    } catch (error) {
      console.error('❌ Error saving transactions:', error);
    }
  }

  async getUserTransactions(userId) {
    const transactions = await this.getTransactions();
    return transactions[userId] || [];
  }

  async saveUserTransactions(userId, userTransactions) {
    const transactions = await this.getTransactions();
    transactions[userId] = userTransactions;
    await this.saveTransactions(transactions);
  }

  async addTransaction(userId, transaction) {
    const transactions = await this.getTransactions();
    if (!transactions[userId]) {
      transactions[userId] = [];
    }
    transactions[userId].push(transaction);
    await this.saveTransactions(transactions);
    return transaction;
  }

  // Virtual Accounts methods
  async getVirtualAccounts() {
    try {
      const data = await fs.readFile(this.virtualAccountsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('❌ Error reading virtual accounts:', error);
      return {};
    }
  }

  async saveVirtualAccounts(virtualAccounts) {
    try {
      await fs.writeFile(this.virtualAccountsFile, JSON.stringify(virtualAccounts, null, 2));
    } catch (error) {
      console.error('❌ Error saving virtual accounts:', error);
    }
  }

  async getVirtualAccountByUserId(userId) {
    const virtualAccounts = await this.getVirtualAccounts();
    const account = virtualAccounts[userId];
    if (account) {
      return { user_id: userId, ...account };
    }
    return null;
  }

  async saveVirtualAccount(userId, accountData) {
    const virtualAccounts = await this.getVirtualAccounts();
    virtualAccounts[userId] = accountData;
    await this.saveVirtualAccounts(virtualAccounts);
    return accountData;
  }

  async findVirtualAccountByNumber(accountNumber) {
    const virtualAccounts = await this.getVirtualAccounts();
    for (const [userId, account] of Object.entries(virtualAccounts)) {
      if (account.account_number === accountNumber) {
        return { user_id: userId, ...account };
      }
    }
    return null;
  }

  // Backup methods
  async backupData() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(this.dataDir, 'backups');
      await fs.mkdir(backupDir, { recursive: true });
      
      const backupFile = path.join(backupDir, `backup-${timestamp}.json`);
      
      const backupData = {
        timestamp: new Date().toISOString(),
        users: await this.getUsers(),
        transactions: await this.getTransactions(),
        virtualAccounts: await this.getVirtualAccounts()
      };
      
      await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
      console.log(`📂 Backup created: ${backupFile}`);
    } catch (error) {
      console.error('❌ Backup error:', error);
    }
  }

  // Cleanup old backups (keep last 7 days)
  async cleanupOldBackups(daysToKeep = 7) {
    try {
      const backupDir = path.join(this.dataDir, 'backups');
      const files = await fs.readdir(backupDir);
      const now = Date.now();
      const cutoff = daysToKeep * 24 * 60 * 60 * 1000;
      
      for (const file of files) {
        if (file.startsWith('backup-')) {
          const filePath = path.join(backupDir, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtime.getTime() > cutoff) {
            await fs.unlink(filePath);
            console.log(`🗑️ Deleted old backup: ${file}`);
          }
        }
      }
    } catch (error) {
      // Silently fail for cleanup
    }
  }
}

// Create and export singleton instance
const database = new Database();

// Schedule regular backups (every 6 hours)
setInterval(() => {
  database.backupData();
  database.cleanupOldBackups();
}, 6 * 60 * 60 * 1000);

module.exports = database;