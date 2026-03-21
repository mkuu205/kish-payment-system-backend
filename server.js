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

// Initialize app
const app = express();

// ==================== MIDDLEWARE ====================
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==================== DATABASE ====================
connectDB();

// ==================== ROUTES ====================

// Root route
app.get('/', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Kish Payment System',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: 'GET /health',
            payment: 'POST /api/payment/stkpush',
            status: 'GET /api/payment/status/:transactionId',
            transactions: 'GET /api/payment/transactions',
            admin: 'POST /api/admin/login'
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Kish Payment System',
        timestamp: new Date().toISOString(),
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});

// Test endpoint
app.get('/test', (req, res) => {
    res.json({ 
        message: 'Test endpoint working!',
        timestamp: new Date().toISOString()
    });
});

// ========== IMPORTANT: API ROUTES MOUNTED HERE ==========
app.use('/api/payment', paymentRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler - catch all undefined routes
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route ${req.method} ${req.url} not found`,
        availableEndpoints: {
            root: 'GET /',
            health: 'GET /health',
            test: 'GET /test',
            payment: 'POST /api/payment/stkpush',
            status: 'GET /api/payment/status/:transactionId',
            transactions: 'GET /api/payment/transactions',
            adminLogin: 'POST /api/admin/login'
        }
    });
});

// ==================== START SERVER ====================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log('\n🚀 ========================================');
    console.log('   Kish Payment System Backend');
    console.log('   ========================================');
    console.log(`   Server running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Payment: POST http://localhost:${PORT}/api/payment/stkpush`);
    console.log(`   Status: GET http://localhost:${PORT}/api/payment/status/:id`);
    console.log('🚀 ========================================\n');
});
