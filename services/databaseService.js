// services/databaseService.js
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Session = require('../models/Session');
const VirtualAccount = require('../models/VirtualAccount');
const { redisClient } = require('../config/database');

class DatabaseService {
  
  // ============== USER METHODS ==============
  
  async initUser(userId, userData = {}) {
    try {
      // Check Redis cache first
      const cachedUser = await this.getUserFromCache(userId);
      if (cachedUser) {
        return cachedUser;
      }
      
      let user = await User.findOne({ telegramId: userId });
      
      if (!user) {
        user = new User({
          telegramId: userId,
          ...userData
        });
        await user.save();
      }
      
      // Cache user in Redis for 5 minutes
      await this.cacheUser(userId, user);
      
      return user.toObject();
    } catch (error) {
      console.error('❌ Error initializing user:', error);
      throw error;
    }
  }
  
  async getUser(userId) {
    try {
      // Check Redis cache first
      const cachedUser = await this.getUserFromCache(userId);
      if (cachedUser) {
        return cachedUser;
      }
      
      const user = await User.findOne({ telegramId: userId });
      if (user) {
        await this.cacheUser(userId, user);
      }
      
      return user ? user.toObject() : null;
    } catch (error) {
      console.error('❌ Error getting user:', error);
      throw error;
    }
  }
  
  async updateUser(userId, updateData) {
    try {
      const user = await User.findOneAndUpdate(
        { telegramId: userId },
        { $set: updateData, $currentDate: { updatedAt: true } },
        { new: true, upsert: false }
      );
      
      if (user) {
        // Invalidate cache
        await redisClient.del(`user:${userId}`);
      }
      
      return user ? user.toObject() : null;
    } catch (error) {
      console.error('❌ Error updating user:', error);
      throw error;
    }
  }
  
  async getAllUsers(limit = 50, skip = 0) {
    try {
      return await User.find({ isActive: true })
        .sort({ joined: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
    } catch (error) {
      console.error('❌ Error getting all users:', error);
      throw error;
    }
  }
  
  async countUsers() {
    try {
      return await User.countDocuments({ isActive: true });
    } catch (error) {
      console.error('❌ Error counting users:', error);
      throw error;
    }
  }
  
  async getUsersByKycStatus(status, limit = 50) {
    try {
      return await User.find({ kyc: status, isActive: true })
        .sort({ joined: -1 })
        .limit(limit)
        .lean();
    } catch (error) {
      console.error('❌ Error getting users by KYC status:', error);
      throw error;
    }
  }
  
  // ============== TRANSACTION METHODS ==============
  
  async createTransaction(transactionData) {
    try {
      const transaction = new Transaction(transactionData);
      await transaction.save();
      
      // Cache recent transaction
      if (transactionData.userId) {
        await this.cacheRecentTransaction(transactionData.userId, transaction);
      }
      
      return transaction.toObject();
    } catch (error) {
      console.error('❌ Error creating transaction:', error);
      throw error;
    }
  }
  
  async getUserTransactions(userId, limit = 10, skip = 0) {
    try {
      // Check Redis cache for recent transactions
      const cacheKey = `transactions:${userId}:${limit}:${skip}`;
      const cached = await redisClient.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      const transactions = await Transaction.find({ userId })
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
      
      // Cache for 1 minute
      await redisClient.setex(cacheKey, 60, JSON.stringify(transactions));
      
      return transactions;
    } catch (error) {
      console.error('❌ Error getting user transactions:', error);
      throw error;
    }
  }
  
  async getTransactionByReference(reference) {
    try {
      return await Transaction.findOne({ reference }).lean();
    } catch (error) {
      console.error('❌ Error getting transaction by reference:', error);
      throw error;
    }
  }
  
  async updateTransactionStatus(reference, status, reason = null) {
    try {
      const updateData = { status };
      if (reason) updateData.reason = reason;
      
      const transaction = await Transaction.findOneAndUpdate(
        { reference },
        { $set: updateData },
        { new: true }
      );
      
      // Invalidate cache if exists
      if (transaction && transaction.userId) {
        await redisClient.del(`transactions:${transaction.userId}:*`);
      }
      
      return transaction ? transaction.toObject() : null;
    } catch (error) {
      console.error('❌ Error updating transaction status:', error);
      throw error;
    }
  }
  
  async getTransactionStats(userId = null) {
    try {
      let match = {};
      if (userId) {
        match.userId = userId;
      }
      
      const stats = await Transaction.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            totalAmount: { $sum: "$amount" },
            successCount: {
              $sum: { $cond: [{ $eq: ["$status", "success"] }, 1, 0] }
            },
            failedCount: {
              $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] }
            },
            pendingCount: {
              $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
            }
          }
        }
      ]);
      
      return stats[0] || {
        totalTransactions: 0,
        totalAmount: 0,
        successCount: 0,
        failedCount: 0,
        pendingCount: 0
      };
    } catch (error) {
      console.error('❌ Error getting transaction stats:', error);
      throw error;
    }
  }
  
  // ============== SESSION METHODS ==============
  
  async createOrUpdateSession(userId, sessionData) {
    try {
      const session = await Session.findOneAndUpdate(
        { userId },
        {
          $set: {
            ...sessionData,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
          }
        },
        { upsert: true, new: true }
      );
      
      // Also cache in Redis for faster access
      await redisClient.setex(`session:${userId}`, 1800, JSON.stringify(session.toObject()));
      
      return session.toObject();
    } catch (error) {
      console.error('❌ Error creating/updating session:', error);
      throw error;
    }
  }
  
  async getSession(userId) {
    try {
      // Check Redis cache first
      const cachedSession = await redisClient.get(`session:${userId}`);
      if (cachedSession) {
        return JSON.parse(cachedSession);
      }
      
      const session = await Session.findOne({ userId });
      
      if (session) {
        // Cache in Redis for 30 minutes
        await redisClient.setex(`session:${userId}`, 1800, JSON.stringify(session.toObject()));
      }
      
      return session ? session.toObject() : null;
    } catch (error) {
      console.error('❌ Error getting session:', error);
      throw error;
    }
  }
  
  async deleteSession(userId) {
    try {
      await Session.deleteOne({ userId });
      await redisClient.del(`session:${userId}`);
    } catch (error) {
      console.error('❌ Error deleting session:', error);
      throw error;
    }
  }
  
  // ============== VIRTUAL ACCOUNT METHODS ==============
  
  async createVirtualAccount(virtualAccountData) {
    try {
      const virtualAccount = new VirtualAccount(virtualAccountData);
      await virtualAccount.save();
      
      // Cache virtual account
      await redisClient.setex(
        `virtualAccount:${virtualAccountData.userId}`,
        3600, // 1 hour
        JSON.stringify(virtualAccount.toObject())
      );
      
      return virtualAccount.toObject();
    } catch (error) {
      console.error('❌ Error creating virtual account:', error);
      throw error;
    }
  }
  
  async getVirtualAccount(userId) {
    try {
      // Check Redis cache first
      const cachedAccount = await redisClient.get(`virtualAccount:${userId}`);
      if (cachedAccount) {
        return JSON.parse(cachedAccount);
      }
      
      const account = await VirtualAccount.findOne({ userId });
      
      if (account) {
        // Cache for 1 hour
        await redisClient.setex(
          `virtualAccount:${userId}`,
          3600,
          JSON.stringify(account.toObject())
        );
      }
      
      return account ? account.toObject() : null;
    } catch (error) {
      console.error('❌ Error getting virtual account:', error);
      throw error;
    }
  }
  
  async updateVirtualAccount(userId, updateData) {
    try {
      const account = await VirtualAccount.findOneAndUpdate(
        { userId },
        { $set: updateData },
        { new: true }
      );
      
      if (account) {
        // Update cache
        await redisClient.setex(
          `virtualAccount:${userId}`,
          3600,
          JSON.stringify(account.toObject())
        );
      }
      
      return account ? account.toObject() : null;
    } catch (error) {
      console.error('❌ Error updating virtual account:', error);
      throw error;
    }
  }
  
  async getAllVirtualAccounts(limit = 50) {
    try {
      return await VirtualAccount.find({ active: true })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    } catch (error) {
      console.error('❌ Error getting all virtual accounts:', error);
      throw error;
    }
  }
  
  // ============== CACHE METHODS ==============
  
  async cacheUser(userId, user) {
    try {
      await redisClient.setex(
        `user:${userId}`,
        300, // 5 minutes
        JSON.stringify(user.toObject ? user.toObject() : user)
      );
    } catch (error) {
      console.error('❌ Error caching user:', error);
    }
  }
  
  async getUserFromCache(userId) {
    try {
      const cached = await redisClient.get(`user:${userId}`);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('❌ Error getting user from cache:', error);
      return null;
    }
  }
  
  async cacheRecentTransaction(userId, transaction) {
    try {
      const cacheKey = `recent_tx:${userId}`;
      const cached = await redisClient.get(cacheKey);
      
      let recentTransactions = cached ? JSON.parse(cached) : [];
      
      // Add new transaction to beginning
      recentTransactions.unshift({
        id: transaction._id || transaction.id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        date: transaction.timestamp || new Date()
      });
      
      // Keep only last 5 transactions
      recentTransactions = recentTransactions.slice(0, 5);
      
      await redisClient.setex(cacheKey, 300, JSON.stringify(recentTransactions));
    } catch (error) {
      console.error('❌ Error caching recent transaction:', error);
    }
  }
  
  async clearUserCache(userId) {
    try {
      const keys = await redisClient.keys(`*:${userId}:*`);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
      await redisClient.del(`user:${userId}`);
      await redisClient.del(`session:${userId}`);
      await redisClient.del(`virtualAccount:${userId}`);
      await redisClient.del(`recent_tx:${userId}`);
    } catch (error) {
      console.error('❌ Error clearing user cache:', error);
    }
  }
  
  // ============== ADMIN METHODS ==============
  
  async getSystemStats() {
    try {
      const cacheKey = 'system:stats';
      const cached = await redisClient.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      const [
        totalUsers,
        approvedKyc,
        pendingKyc,
        virtualAccounts,
        transactionStats,
        totalBalance
      ] = await Promise.all([
        User.countDocuments({ isActive: true }),
        User.countDocuments({ kyc: 'approved', isActive: true }),
        User.countDocuments({ kyc: 'pending', isActive: true }),
        VirtualAccount.countDocuments({ active: true }),
        this.getTransactionStats(),
        User.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: null, total: { $sum: "$wallet" } } }
        ])
      ]);
      
      const stats = {
        totalUsers,
        approvedKyc,
        pendingKyc,
        virtualAccounts,
        totalBalance: totalBalance[0]?.total || 0,
        transactionStats
      };
      
      // Cache for 5 minutes
      await redisClient.setex(cacheKey, 300, JSON.stringify(stats));
      
      return stats;
    } catch (error) {
      console.error('❌ Error getting system stats:', error);
      throw error;
    }
  }
  
  async searchUsers(query, limit = 20) {
    try {
      return await User.find({
        $or: [
          { telegramId: { $regex: query, $options: 'i' } },
          { username: { $regex: query, $options: 'i' } },
          { fullName: { $regex: query, $options: 'i' } },
          { phone: { $regex: query, $options: 'i' } }
        ],
        isActive: true
      })
      .sort({ joined: -1 })
      .limit(limit)
      .lean();
    } catch (error) {
      console.error('❌ Error searching users:', error);
      throw error;
    }
  }
}

module.exports = new DatabaseService();