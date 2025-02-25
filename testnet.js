require('./alive);

// Simple Testnet Blockchain Implementation
// This implementation uses Node.js with Express for the API

const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const EC = require('elliptic').ec;
const ec = new EC('secp256k1'); // Same elliptic curve used by Bitcoin
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
  }

  // Calculate hash for the transaction
  calculateHash() {
    return crypto.createHash('sha256')
      .update(this.fromAddress + this.toAddress + this.amount + this.timestamp)
      .digest('hex');
  }

  // Sign the transaction
  signTransaction(signingKey) {
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
    // Special case for mining rewards
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
    this.nonce = 0;
  }

  // Calculate hash of the block
  calculateHash() {
    return crypto.createHash('sha256')
      .update(this.previousHash + this.timestamp + JSON.stringify(this.transactions) + this.nonce)
      .digest('hex');
  }

  // Proof of work (simplified)
  mineBlock(difficulty) {
    const target = Array(difficulty + 1).join('0');
    
    while (this.hash.substring(0, difficulty) !== target) {
      this.nonce++;
      this.hash = this.calculateHash();
    }

    console.log(`Block mined: ${this.hash}`);
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
    this.difficulty = 2; // Determines how long it takes to mine a block
    this.pendingTransactions = [];
    this.miningReward = 100;
    this.transactionsPerBlock = 5; // Similar to Solana's high throughput
  }

  // Create the first block
  createGenesisBlock() {
    return new Block(Date.now(), [], '0');
  }

  // Get the latest block
  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  // Mining rewards and adding new blocks
  minePendingTransactions(miningRewardAddress) {
    // Instead of mining just one transaction, mine as many as possible (batching)
    const transactionsToMine = this.pendingTransactions.slice(0, this.transactionsPerBlock);
    
    // Create a new block with the pending transactions
    const block = new Block(Date.now(), transactionsToMine, this.getLatestBlock().hash);
    
    // Mine the block (simplified)
    block.mineBlock(this.difficulty);
    
    console.log('Block successfully mined!');
    this.chain.push(block);
    
    // Update the pending transactions (remove the ones that were just mined)
    this.pendingTransactions = this.pendingTransactions.slice(this.transactionsPerBlock);
    
    // Add the mining reward transaction
    this.pendingTransactions.unshift(
      new Transaction(null, miningRewardAddress, this.miningReward)
    );
  }

  // Add a new transaction
  addTransaction(transaction) {
    // Verify from/to address and signature
    if (!transaction.fromAddress || !transaction.toAddress) {
      throw new Error('Transaction must include from and to address');
    }

    if (!transaction.isValid() && transaction.fromAddress !== null) {
      throw new Error('Cannot add invalid transaction to the chain');
    }

    this.pendingTransactions.push(transaction);
    return this.pendingTransactions.length;
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
}

// Create a new blockchain instance
const testnetCoin = new Blockchain();

// In-memory wallet storage
const wallets = {};
const testFaucet = {
  address: "faucet_address",
  balance: 1000000 // Initial faucet balance
};

// API Endpoints

// Create a new wallet
app.get('/api/create-wallet', (req, res) => {
  const key = ec.genKeyPair();
  const publicKey = key.getPublic('hex');
  const privateKey = key.getPrivate('hex');
  
  wallets[publicKey] = {
    publicKey,
    privateKey,
    transactions: []
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

// Request tokens from faucet
app.post('/api/faucet', (req, res) => {
  const { address, amount } = req.body;
  
  if (!address) {
    return res.status(400).json({ error: "Address is required" });
  }
  
  const faucetAmount = amount || 100; // Default amount
  
  if (faucetAmount > 1000) {
    return res.status(400).json({ error: "Maximum faucet request is 1000 coins" });
  }
  
  // Create a transaction from faucet to the requested address
  const tx = new Transaction(null, address, faucetAmount);
  testnetCoin.addTransaction(tx);
  
  // Mine the block to confirm the transaction
  testnetCoin.minePendingTransactions(testFaucet.address);
  
  res.json({ 
    success: true,
    message: `${faucetAmount} coins have been sent to ${address}`,
    newBalance: testnetCoin.getBalanceOfAddress(address)
  });
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
    testnetCoin.addTransaction(tx);
    
    // If there are enough transactions or it's time, mine a block
    if (testnetCoin.pendingTransactions.length >= testnetCoin.transactionsPerBlock) {
      testnetCoin.minePendingTransactions(testFaucet.address);
    }
    
    res.json({
      success: true,
      message: `Transaction of ${amount} coins has been added to the pending transactions`,
      pendingTransactions: testnetCoin.pendingTransactions.length,
      transactionHash: tx.calculateHash()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get blockchain data
app.get('/api/blockchain', (req, res) => {
  res.json(testnetCoin);
});

// Get pending transactions
app.get('/api/pending-transactions', (req, res) => {
  res.json(testnetCoin.pendingTransactions);
});

// Mine pending transactions
app.post('/api/mine', (req, res) => {
  const { minerAddress } = req.body;
  
  if (!minerAddress) {
    return res.status(400).json({ error: "Miner address is required" });
  }
  
  testnetCoin.minePendingTransactions(minerAddress);
  
  res.json({
    success: true,
    message: "Block mined successfully",
    reward: "You will receive your mining reward in the next block",
    pendingTransactions: testnetCoin.pendingTransactions.length
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Testnet blockchain running on http://localhost:${PORT}`);
  console.log('Creating genesis block...');
  // Pre-mine some blocks to make the chain valid
  testnetCoin.minePendingTransactions(testFaucet.address);
});
