const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Transaction = require('../models/Transaction');

// Admin authentication middleware
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.username !== process.env.ADMIN_USERNAME) {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
        
        req.admin = decoded;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
};

// Admin login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (username !== process.env.ADMIN_USERNAME) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const isValid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
        
        if (!isValid) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { username, role: 'admin' },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            token,
            expiresIn: 86400
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get dashboard stats
router.get('/stats', authenticateAdmin, async (req, res) => {
    try {
        const stats = await Transaction.getStats();
        const dailyRevenue = await Transaction.getDailyRevenue(7);
        
        res.json({
            success: true,
            data: {
                ...stats,
                dailyRevenue
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch stats' });
    }
});

// Get all transactions with filters
router.get('/transactions', authenticateAdmin, async (req, res) => {
    try {
        const { status, startDate, endDate, page = 1, limit = 50 } = req.query;
        
        const filter = {};
        
        if (status) filter.status = status;
        
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const [transactions, total] = await Promise.all([
            Transaction.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Transaction.countDocuments(filter)
        ]);
        
        res.json({
            success: true,
            data: {
                transactions,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
    } catch (error) {
        console.error('Fetch transactions error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch transactions' });
    }
});

// Get single transaction
router.get('/transaction/:id', authenticateAdmin, async (req, res) => {
    try {
        const transaction = await Transaction.findOne({
            $or: [
                { _id: req.params.id },
                { transactionId: req.params.id }
            ]
        });
        
        if (!transaction) {
            return res.status(404).json({ success: false, message: 'Transaction not found' });
        }
        
        res.json({
            success: true,
            data: transaction
        });
    } catch (error) {
        console.error('Get transaction error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch transaction' });
    }
});

module.exports = router;
