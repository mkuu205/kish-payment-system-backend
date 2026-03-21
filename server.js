const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import routes
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');
const connectDB = require('./config/db');

// Initialize express app
const app = express();

// ==================== MIDDLEWARE ====================

// CORS configuration
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5500', 'https://kish-payment-system.vercel.app'],
    credentials: true
}));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==================== DATABASE CONNECTION ====================

connectDB();

// ==================== ROUTES ====================

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        name: 'Kish Payment System API',
        version: '1.0.0',
        status: 'running',
        endpoints: {
            health: 'GET /health',
            payment: {
                initiate: 'POST /api/payment/stkpush',
                callback: 'POST /api/payment/callback',
                status: 'GET /api/payment/status/:transactionId',
                transactions: 'GET /api/payment/transactions'
            },
            admin: {
                login: 'POST /api/admin/login',
                stats: 'GET /api/admin/stats',
                transactions: 'GET /api/admin/transactions',
                transaction: 'GET /api/admin/transaction/:id'
            }
        },
        documentation: 'https://github.com/yourusername/kish-payment-backend'
    });
});

// API Routes
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

// Test endpoint to verify routing
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Server is working!',
        timestamp: new Date().toISOString(),
        routes: {
            health: '/health',
            payment: '/api/payment/stkpush',
            admin: '/api/admin/login'
        }
    });
});

// ==================== ERROR HANDLING ====================

// 404 Handler - Catch all undefined routes
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.url} not found`,
        availableEndpoints: {
            health: 'GET /health',
            test: 'GET /test',
            payment: 'POST /api/payment/stkpush',
            status: 'GET /api/payment/status/:transactionId',
            adminLogin: 'POST /api/admin/login'
        }
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Global error:', err.stack);
    
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// ==================== START SERVER ====================

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
    console.log(`\n🚀 ========================================`);
    console.log(`   Kish Payment System Backend`);
    console.log(`   ========================================`);
    console.log(`   Server running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   API base: http://localhost:${PORT}/api`);
    console.log(`🚀 ========================================\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        mongoose.connection.close(false, () => {
            console.log('MongoDB connection closed');
            process.exit(0);
        });
    });
});

module.exports = app;
