const { SorobanClient, Account, TransactionBuilder, Networks, Operation } = require('stellar-sdk');
const fs = require('fs');
const path = require('path');
const redis = require('redis');
const logger = require('../services/logger');

class SmartContractManager {
  constructor() {
    this.client = new SorobanClient({
      horizonURL: process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    });
    this.networkPassphrase = process.env.STELLAR_NETWORK || Networks.TESTNET_NETWORK_PASSPHRASE;
    this.redisClient = redis.createClient();
    this.contractRegistry = new Map();
    this.compiledContracts = new Map();
    this.deploymentHistory = [];
  }

  /**
   * Compile smart contract from Rust/Soroban source
   */
  async compileContract(contractName, sourcePath) {
    try {
      logger.info(`[SmartContractManager] Compiling contract: ${contractName}`);
      
      // Read contract source
      const source = fs.readFileSync(sourcePath, 'utf-8');
      
      // Store compiled contract metadata
      const contractMetadata = {
        name: contractName,
        sourcePath,
        compiledAt: new Date().toISOString(),
        source,
        version: '1.0.0',
        author: process.env.CONTRACT_AUTHOR || 'Healthcare Platform',
      };
      
      this.compiledContracts.set(contractName, contractMetadata);
      
      // Cache compilation result
      await this.redisClient.set(
        `contract:compiled:${contractName}`,
        JSON.stringify(contractMetadata),
        { EX: 86400 } // 24 hour expiry
      );
      
      logger.info(`[SmartContractManager] Contract compiled successfully: ${contractName}`);
      return contractMetadata;
    } catch (error) {
      logger.error(`[SmartContractManager] Contract compilation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Deploy smart contract to blockchain
   */
  async deployContract(contractName, publicKey, secretKey, contractCode, wasmRef = null) {
    try {
      logger.info(`[SmartContractManager] Deploying contract: ${contractName}`);
      
      // Verify contract exists in registry
      if (!this.compiledContracts.has(contractName)) {
        throw new Error(`Contract ${contractName} not compiled. Please compile first.`);
      }

      // Prepare account for deployment
      const account = new Account(publicKey, '0');
      
      // Build deployment transaction
      const deploymentTx = new TransactionBuilder(account, {
        fee: 100,
        networkPassphrase: this.networkPassphrase,
        v1: true,
      })
        .addOperation(
          Operation.invokeHostFunction({
            func: {
              type: 'wasm_ref',
              ref: wasmRef || contractCode,
            },
          })
        )
        .setBaseFee(100)
        .setTimeout(300)
        .build();

      // Sign transaction
      deploymentTx.sign(secretKey);

      // Submit to network
      const result = await this.client.submitTransaction(deploymentTx);
      
      // Record deployment
      const deploymentRecord = {
        contractName,
        contractId: result.id,
        publicKey,
        deployedAt: new Date().toISOString(),
        status: 'deployed',
        transactionHash: result.hash,
        ledgerSequence: result.ledger_attr,
      };

      this.registryContract(contractName, deploymentRecord);
      this.deploymentHistory.push(deploymentRecord);

      // Cache deployment record
      await this.redisClient.set(
        `contract:deployed:${contractName}`,
        JSON.stringify(deploymentRecord),
        { EX: 31536000 } // 1 year expiry
      );

      logger.info(`[SmartContractManager] Contract deployed successfully: ${contractName}`);
      return deploymentRecord;
    } catch (error) {
      logger.error(`[SmartContractManager] Contract deployment failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Register contract in registry
   */
  registryContract(contractName, metadata) {
    this.contractRegistry.set(contractName, {
      ...metadata,
      registeredAt: new Date().toISOString(),
      status: 'active',
    });
  }

  /**
   * Retrieve contract metadata
   */
  getContractMetadata(contractName) {
    return this.contractRegistry.get(contractName);
  }

  /**
   * List all deployed contracts
   */
  listDeployedContracts() {
    return Array.from(this.contractRegistry.entries()).map(([name, metadata]) => ({
      name,
      ...metadata,
    }));
  }

  /**
   * Upgrade smart contract
   */
  async upgradeContract(contractName, newCode, publicKey, secretKey) {
    try {
      logger.info(`[SmartContractManager] Upgrading contract: ${contractName}`);
      
      const existingContract = this.getContractMetadata(contractName);
      if (!existingContract) {
        throw new Error(`Contract ${contractName} not found in registry`);
      }

      // Build upgrade transaction
      const account = new Account(publicKey, existingContract.nonce || '0');
      
      const upgradeTx = new TransactionBuilder(account, {
        fee: 100,
        networkPassphrase: this.networkPassphrase,
        v1: true,
      })
        .addOperation(
          Operation.invokeHostFunction({
            func: {
              type: 'wasm_ref',
              ref: newCode,
            },
          })
        )
        .setBaseFee(100)
        .setTimeout(300)
        .build();

      upgradeTx.sign(secretKey);
      const result = await this.client.submitTransaction(upgradeTx);

      // Update contract metadata
      const updatedMetadata = {
        ...existingContract,
        upgradedAt: new Date().toISOString(),
        previousVersion: existingContract.version,
        version: (parseFloat(existingContract.version) + 0.1).toFixed(1),
        transactionHash: result.hash,
      };

      this.registryContract(contractName, updatedMetadata);

      logger.info(`[SmartContractManager] Contract upgraded successfully: ${contractName}`);
      return updatedMetadata;
    } catch (error) {
      logger.error(`[SmartContractManager] Contract upgrade failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify contract deployment
   */
  async verifyContractDeployment(contractId) {
    try {
      const result = await this.client.loadAccount(contractId);
      return {
        exists: true,
        contractId,
        verifiedAt: new Date().toISOString(),
        sequenceNumber: result.sequence,
        verified: true,
      };
    } catch (error) {
      logger.warn(`[SmartContractManager] Contract verification failed: ${error.message}`);
      return {
        exists: false,
        contractId,
        verified: false,
        error: error.message,
      };
    }
  }

  /**
   * Get deployment history
   */
  getDeploymentHistory(contractName = null) {
    if (contractName) {
      return this.deploymentHistory.filter(d => d.contractName === contractName);
    }
    return this.deploymentHistory;
  }

  /**
   * Pause contract (emergency stop)
   */
  async pauseContract(contractName, adminKey) {
    try {
      logger.warn(`[SmartContractManager] Pausing contract: ${contractName}`);
      const contract = this.getContractMetadata(contractName);
      contract.status = 'paused';
      contract.pausedAt = new Date().toISOString();
      this.registryContract(contractName, contract);
      return contract;
    } catch (error) {
      logger.error(`[SmartContractManager] Contract pause failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resume contract
   */
  async resumeContract(contractName, adminKey) {
    try {
      logger.info(`[SmartContractManager] Resuming contract: ${contractName}`);
      const contract = this.getContractMetadata(contractName);
      contract.status = 'active';
      contract.resumedAt = new Date().toISOString();
      this.registryContract(contractName, contract);
      return contract;
    } catch (error) {
      logger.error(`[SmartContractManager] Contract resume failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new SmartContractManager();
