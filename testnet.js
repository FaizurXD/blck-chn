require('./alive');
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const app = express();
const PORT = 3000;

// Use middleware
app.use(bodyParser.json());

// Data structures
class Transaction {
  constructor(fromAddress, toAddress, amount) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = Date.now();
    this.signature = null;
    this.transactionId = crypto.randomBytes(32).toString('hex');
  }

  // Calculate hash for the transaction
  calculateHash() {
    return crypto.createHash('sha256')
      .update(this.fromAddress + this.toAddress + this.amount + this.timestamp)
      .digest('hex');
  }

  // Sign the transaction
  signTransaction(signingKey) {
    // Skip signature check for faucet (null fromAddress)
    if (this.fromAddress === null) return;
    
    // You can only send from your own wallet
    if (signingKey.getPublic('hex') !== this.fromAddress) {
      throw new Error('You cannot sign transactions for other wallets!');
    }

    const hashTx = this.calculateHash();
    const sig = signingKey.sign(hashTx, 'base64');
    this.signature = sig.toDER('hex');
  }

  // Verify transaction signature
  isValid() {
    // Special case for system transactions (like faucet or rewards)
    if (this.fromAddress === null) return true;

    if (!this.signature || this.signature.length === 0) {
      throw new Error('No signature in this transaction');
    }

    const publicKey = ec.keyFromPublic(this.fromAddress, 'hex');
    return publicKey.verify(this.calculateHash(), this.signature);
  }
}

class Block {
  constructor(timestamp, transactions, previousHash = '') {
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.hash = this.calculateHash();
    this.slot = Date.now(); // Solana-like slot number (timestamp)
    this.validator = 'system'; // In this simplified model, all blocks are validated by the system
  }

  // Calculate hash of the block
  calculateHash() {
    return crypto.createHash('sha256')
      .update(this.previousHash + this.timestamp + JSON.stringify(this.transactions) + this.slot)
      .digest('hex');
  }

  // Validate all transactions in the block
  hasValidTransactions() {
    for (const tx of this.transactions) {
      if (!tx.isValid()) {
        return false;
      }
    }
    return true;
  }
}

class Blockchain {
  constructor() {
    this.chain = [this.createGenesisBlock()];
    this.pendingTransactions = [];
    this.transactionsPerBlock = 20; // Higher throughput like Solana
    this.validatorReward = 10; // Smaller reward since validation is automatic
    this.autoValidationInterval = 2000; // Auto-validate every 2 seconds (configurable)
    this.faucetKeyPair = ec.genKeyPair(); // Generate a dedicated key for the faucet
    this.faucetAddress = this.faucetKeyPair.getPublic('hex');
    
    // Initialize faucet with funds in genesis
    const faucetTx = new Transaction(null, this.faucetAddress, 10000000);
    this.pendingTransactions.push(faucetTx);
    
    // Start automatic validation (Solana-like)
    this.startAutoValidation();
  }

  // Create the first block
  createGenesisBlock() {
    return new Block(Date.now(), [], '0');
  }

  // Get the latest block
  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  // Auto-validate transactions periodically (Solana-like)
  startAutoValidation() {
    setInterval(() => {
      this.validatePendingTransactions();
    }, this.autoValidationInterval);
  }

  // Validate pending transactions and add them to the blockchain
  validatePendingTransactions() {
    // Skip if no pending transactions
    if (this.pendingTransactions.length === 0) return;
    
    // Get transactions to include in the current block
    const transactionsToValidate = this.pendingTransactions.slice(0, this.transactionsPerBlock);
    
    // Create new block
    const block = new Block(Date.now(), transactionsToValidate, this.getLatestBlock().hash);
    
    // Add block to chain
    this.chain.push(block);
    
    // Remove processed transactions from pending
    this.pendingTransactions = this.pendingTransactions.slice(this.transactionsPerBlock);
    
    console.log(`Block validated: ${block.hash} | Transactions: ${transactionsToValidate.length}`);
  }

  // Add a new transaction
  addTransaction(transaction) {
    // Verify from/to address and signature
    if (!transaction.toAddress) {
      throw new Error('Transaction must include a destination address');
    }

    // Special case for system transactions (faucet, rewards)
    if (transaction.fromAddress === null) {
      this.pendingTransactions.push(transaction);
      return transaction.transactionId;
    }

    // Normal user transactions
    if (!transaction.fromAddress) {
      throw new Error('Transaction must include a sender address');
    }

    if (!transaction.isValid()) {
      throw new Error('Cannot add invalid transaction to the chain');
    }

    this.pendingTransactions.push(transaction);
    return transaction.transactionId;
  }

  // Get balance of an address
  getBalanceOfAddress(address) {
    let balance = 0;

    // Go through all blocks and transactions
    for (const block of this.chain) {
      for (const trans of block.transactions) {
        // If the address is the sender, decrease the balance
        if (trans.fromAddress === address) {
          balance -= trans.amount;
        }

        // If the address is the recipient, increase the balance
        if (trans.toAddress === address) {
          balance += trans.amount;
        }
      }
    }

    // Check pending transactions too
    for (const trans of this.pendingTransactions) {
      if (trans.fromAddress === address) {
        balance -= trans.amount;
      }
      if (trans.toAddress === address) {
        balance += trans.amount;
      }
    }

    return balance;
  }

  // Get transaction history for an address
  getTransactionHistory(address) {
    const history = [];
    
    // Check confirmed transactions
    for (const block of this.chain) {
      for (const trans of block.transactions) {
        if (trans.fromAddress === address || trans.toAddress === address) {
          history.push({
            ...trans,
            status: 'confirmed',
            blockHash: block.hash,
            slot: block.slot
          });
        }
      }
    }
    
    // Check pending transactions
    for (const trans of this.pendingTransactions) {
      if (trans.fromAddress === address || trans.toAddress === address) {
        history.push({
          ...trans,
          status: 'pending'
        });
      }
    }
    
    return history.sort((a, b) => b.timestamp - a.timestamp); // Sort newest first
  }

  // Validate the integrity of the blockchain
  isChainValid() {
    // Check each block
    for (let i = 1; i < this.chain.length; i++) {
      const currentBlock = this.chain[i];
      const previousBlock = this.chain[i - 1];

      // Validate block's transactions
      if (!currentBlock.hasValidTransactions()) {
        return false;
      }

      // Check if the current block's hash is correct
      if (currentBlock.hash !== currentBlock.calculateHash()) {
        return false;
      }

      // Check if this block points to the correct previous block
      if (currentBlock.previousHash !== previousBlock.hash) {
        return false;
      }
    }
    return true;
  }
  
  // Get transaction by ID
  getTransaction(transactionId) {
    // Check confirmed transactions
    for (const block of this.chain) {
      for (const trans of block.transactions) {
        if (trans.transactionId === transactionId) {
          return {
            ...trans,
            status: 'confirmed',
            blockHash: block.hash,
            slot: block.slot
          };
        }
      }
    }
    
    // Check pending transactions
    for (const trans of this.pendingTransactions) {
      if (trans.transactionId === transactionId) {
        return {
          ...trans,
          status: 'pending'
        };
      }
    }
    
    return null;
  }
}

// Create a new blockchain instance
const testnetCoin = new Blockchain();

// In-memory wallet storage
const wallets = {};

// API Endpoints
app.get('/', (req, res) => {
    res.send('<h1>SolanaLike Testnet - Running</h1>');
});

// Create a new wallet
app.get('/api/create-wallet', (req, res) => {
  const key = ec.genKeyPair();
  const publicKey = key.getPublic('hex');
  const privateKey = key.getPrivate('hex');
  
  wallets[publicKey] = {
    publicKey,
    privateKey
  };
  
  res.json({
    publicAddress: publicKey,
    privateKey: privateKey,
    message: "Keep your private key safe and don't share it!"
  });
});

// Get wallet balance
app.get('/api/balance/:address', (req, res) => {
  const balance = testnetCoin.getBalanceOfAddress(req.params.address);
  res.json({ address: req.params.address, balance });
});

// Get transaction history for an address
app.get('/api/history/:address', (req, res) => {
  const history = testnetCoin.getTransactionHistory(req.params.address);
  res.json({ address: req.params.address, transactions: history });
});

// Get transaction details
app.get('/api/transaction/:id', (req, res) => {
  const transaction = testnetCoin.getTransaction(req.params.id);
  if (!transaction) {
    return res.status(404).json({ error: "Transaction not found" });
  }
  res.json(transaction);
});

// Request tokens from faucet - FIXED
app.post('/api/faucet', (req, res) => {
  const { address, amount } = req.body;
  
  if (!address) {
    return res.status(400).json({ error: "Address is required" });
  }
  
  const faucetAmount = amount || 100; // Default amount
  
  if (faucetAmount > 1000) {
    return res.status(400).json({ error: "Maximum faucet request is 1000 coins" });
  }
  
  try {
    // Create a system transaction (null fromAddress for faucet)
    const tx = new Transaction(null, address, faucetAmount);
    
    // No need to sign system transactions (fixed bug)
    const txId = testnetCoin.addTransaction(tx);
    
    res.json({ 
      success: true,
      message: `${faucetAmount} coins will be sent to ${address}`,
      transactionId: txId,
      note: "Transaction will be confirmed in the next validation cycle (typically within 2 seconds)"
    });
  } catch (error) {
    console.error("Faucet error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Make a transaction
app.post('/api/transaction', (req, res) => {
  const { fromAddress, privateKey, toAddress, amount } = req.body;
  
  if (!fromAddress || !privateKey || !toAddress || !amount) {
    return res.status(400).json({ error: "Missing required transaction data" });
  }
  
  try {
    // Create a key object from the private key
    const signingKey = ec.keyFromPrivate(privateKey);
    
    // Verify that the public key matches
    if (signingKey.getPublic('hex') !== fromAddress) {
      return res.status(401).json({ error: "You cannot sign transactions for other wallets!" });
    }
    
    // Check balance
    const balance = testnetCoin.getBalanceOfAddress(fromAddress);
    if (balance < amount) {
      return res.status(400).json({ error: "Not enough funds for this transaction" });
    }
    
    // Create and sign the transaction
    const tx = new Transaction(fromAddress, toAddress, amount);
    tx.signTransaction(signingKey);
    
    // Add transaction to pending
    const txId = testnetCoin.addTransaction(tx);
    
    res.json({
      success: true,
      message: `Transaction of ${amount} coins has been submitted`,
      transactionId: txId,
      note: "Transaction will be confirmed in the next validation cycle (typically within 2 seconds)"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get blockchain data
app.get('/api/blockchain', (req, res) => {
  res.json({
    chainLength: testnetCoin.chain.length,
    blocks: testnetCoin.chain.map(block => ({
      hash: block.hash,
      slot: block.slot,
      timestamp: block.timestamp,
      transactionCount: block.transactions.length
    }))
  });
});

// Get specific block data
app.get('/api/block/:hash', (req, res) => {
  const block = testnetCoin.chain.find(b => b.hash === req.params.hash);
  if (!block) {
    return res.status(404).json({ error: "Block not found" });
  }
  res.json(block);
});

// Get pending transactions
app.get('/api/pending-transactions', (req, res) => {
  res.json({
    count: testnetCoin.pendingTransactions.length,
    transactions: testnetCoin.pendingTransactions.map(tx => ({
      id: tx.transactionId,
      from: tx.fromAddress || 'system',
      to: tx.toAddress,
      amount: tx.amount,
      timestamp: tx.timestamp
    }))
  });
});

// Get blockchain stats
app.get('/api/stats', (req, res) => {
  const totalTransactions = testnetCoin.chain.reduce(
    (sum, block) => sum + block.transactions.length, 0) + 
    testnetCoin.pendingTransactions.length;
  
  const latestBlock = testnetCoin.getLatestBlock();
  
  res.json({
    blocks: testnetCoin.chain.length,
    transactions: totalTransactions,
    pendingTransactions: testnetCoin.pendingTransactions.length,
    latestBlockHash: latestBlock.hash,
    latestBlockTimestamp: latestBlock.timestamp,
    autoValidationInterval: testnetCoin.autoValidationInterval,
    transactionsPerBlock: testnetCoin.transactionsPerBlock
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Testnet blockchain running on http://localhost:${PORT}`);
  console.log('Auto-validation started - transactions will be processed automatically');
});
