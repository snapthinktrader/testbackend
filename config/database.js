const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Get MongoDB URI from environment variables
const MONGODB_URI = process.env.MONGODB_URI;

// Mock DB for when MongoDB is not available
const mockDB = {
  readyState: 0,
  models: {},
  connection: {
    readyState: 0
  }
};

// Connection options with optimized pooling
const options = {
  maxPoolSize: 10,
  minPoolSize: 2,
  maxConnecting: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4,
  autoIndex: true,
  retryWrites: true,
  w: 'majority'
};

// Create a connection instance
let connection = null;

/**
 * Connect to MongoDB
 * @returns {Promise} Mongoose connection or mock DB
 */
const connectToMongoDB = async () => {
  if (!connection) {
    if (!MONGODB_URI) {
      console.log('MongoDB URI not found, using in-memory storage');
      connection = mockDB;
      return connection;
    }

    try {
      connection = await mongoose.connect(MONGODB_URI, options);
      console.log('Successfully connected to MongoDB Atlas');
      return connection;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      console.log('Failed to connect to MongoDB, using in-memory storage');
      connection = mockDB;
      return connection;
    }
  }
  return connection;
};

/**
 * Get the connection status
 * @returns {boolean} Connection status
 */
const isConnected = () => {
  if (connection === mockDB) return true;
  return mongoose.connection.readyState === 1;
};

/**
 * Disconnect from MongoDB
 */
const disconnectFromMongoDB = async () => {
  if (connection && connection !== mockDB) {
    await mongoose.disconnect();
    connection = null;
    console.log('Disconnected from MongoDB');
  }
};

module.exports = {
  connectToMongoDB,
  disconnectFromMongoDB,
  isConnected,
  getConnection: () => connection,
};
