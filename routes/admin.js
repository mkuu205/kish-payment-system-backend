const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const bcrypt = require('bcryptjs');

// Simple admin login (no JWT for simplicity - but you can add it)
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        console.log('Login attempt:', { username, passwordProvided: !!password });
        
        // Get admin credentials from environment
        const adminUsername = process.env.ADMIN_USERNAME || 'kish';
        const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
        
        // Check username
        if (username !== adminUsername) {
            console.log('Username mismatch');
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        // Check password using bcrypt
        const isValid = await bcrypt.compare(password, adminPasswordHash);
        
        if (!isValid) {
            console.log('Password mismatch');
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        console.log('Login successful');
        
        // Return success with simple token (you can implement JWT later)
        res.json({
            success: true,
            token: 'simple-token-for-testing',
            message: 'Login successful'
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error during login' 
        });
    }
});

// Get dashboard stats
router.get('/stats', async (req, res) => {
    try {
        const total = await Transaction.countDocuments();
        const successful = await Transaction.countDocuments({ status: 'SUCCESS' });
        const failed = await Transaction.countDocuments({ status: 'FAILED' });
        const pending = await Transaction.countDocuments({ status: 'PENDING' });
        
        const revenue = await Transaction.aggregate([
            { $match: { status: 'SUCCESS' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        
        res.json({
            success: true,
            data: {
                totalTransactions: total,
                successfulTransactions: successful,
                failedTransactions: failed,
                pendingTransactions: pending,
                totalRevenue: revenue[0]?.total || 0
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch stats' 
        });
    }
});

// Get all transactions
router.get('/transactions', async (req, res) => {
    try {
        const { status, page = 1, limit = 50 } = req.query;
        
        const filter = {};
        if (status) filter.status = status;
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const transactions = await Transaction.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
        
        const total = await Transaction.countDocuments(filter);
        
        res.json({
            success: true,
            data: transactions,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get transactions error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch transactions' 
        });
    }
});

// Get single transaction
router.get('/transaction/:id', async (req, res) => {
    try {
        const transaction = await Transaction.findOne({
            $or: [
                { _id: req.params.id },
                { transactionId: req.params.id }
            ]
        });
        
        if (!transaction) {
            return res.status(404).json({ 
                success: false, 
                message: 'Transaction not found' 
            });
        }
        
        res.json({
            success: true,
            data: transaction
        });
    } catch (error) {
        console.error('Get transaction error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch transaction' 
        });
    }
});

module.exports = router;
