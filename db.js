const mongoose = require("mongoose");

const mongoUri = "mongodb://127.0.0.1:27017/liteway"; // Local MongoDB

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB connected"))
.catch((err) => console.error("❌ MongoDB connection error:", err));

module.exports = mongoose;
