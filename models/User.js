// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  firstName: String,
  lastName: String,
  username: String,
  wallet: {
    type: Number,
    default: 0,
    min: 0
  },
  kyc: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  pin: {
    type: String,
    minlength: 4,
    maxlength: 4
  },
  pinAttempts: {
    type: Number,
    default: 0
  },
  pinLocked: {
    type: Boolean,
    default: false
  },
  email: String,
  phone: String,
  fullName: String,
  bvn: String,
  virtualAccount: String,
  virtualAccountNumber: String,
  virtualAccountBank: String,
  dailyDeposit: {
    type: Number,
    default: 0
  },
  dailyTransfer: {
    type: Number,
    default: 0
  },
  lastDeposit: Date,
  lastTransfer: Date,
  joined: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    notifications: {
      type: Boolean,
      default: true
    },
    transactionAlerts: {
      type: Boolean,
      default: true
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update updatedAt on save
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('User', userSchema);