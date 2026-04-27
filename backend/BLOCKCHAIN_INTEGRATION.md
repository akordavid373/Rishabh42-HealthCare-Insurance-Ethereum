# Blockchain Integration Layer - Healthcare Insurance Platform

## Overview

The Blockchain Integration Layer provides comprehensive blockchain services for the Healthcare Insurance platform, enabling secure, transparent, and efficient transaction management on the Stellar blockchain network.

## Architecture

The layer consists of 7 core components:

### 1. Smart Contract Manager (`smartContractManager.js`)
- Compile smart contracts from Soroban/Rust source code
- Deploy contracts to Stellar network
- Upgrade contracts with version control
- Verify contract deployment
- Emergency pause/resume functionality
- Contract registry and metadata management

**Key Features:**
- Full contract lifecycle management
- Deployment history tracking
- Contract versioning
- Redis caching for performance

**API Endpoints:**
```
POST   /api/blockchain/contracts/compile      - Compile smart contract
POST   /api/blockchain/contracts/deploy       - Deploy contract to blockchain
GET    /api/blockchain/contracts/deployed     - List all deployed contracts
GET    /api/blockchain/contracts/:name        - Get contract metadata
POST   /api/blockchain/contracts/verify       - Verify deployment
POST   /api/blockchain/contracts/upgrade      - Upgrade contract version
```

### 2. Transaction Manager (`transactionManager.js`)
- Build transactions with support for multiple operations
- Sign transactions with secret keys
- Submit transactions to blockchain
- Track transaction status and history
- Batch processing for efficiency
- Retry mechanism with exponential backoff
- Transaction pool management

**Key Features:**
- Multi-operation support
- Fee-based priority levels (low, standard, priority, urgent)
- Nonce management for account sequencing
- Transaction pooling (max 1000)
- Real-time status tracking

**API Endpoints:**
```
POST   /api/blockchain/transactions/build     - Build new transaction
POST   /api/blockchain/transactions/sign      - Sign transaction
GET    /api/blockchain/transactions/:txId     - Get transaction status
GET    /api/blockchain/transactions/history/:pk - Get transaction history
GET    /api/blockchain/transactions/pool/status - Get pool info
POST   /api/blockchain/transactions/batch     - Batch transactions
```

### 3. Oracle Service (`oracleService.js`)
- Register and manage data feeds
- Price feed monitoring
- Multi-source support (Stellar, Chainlink, Band Protocol)
- Real-time price updates with volatility calculation
- Event-driven subscriptions
- Data validation and error handling

**Key Features:**
- Real-time data feeds from multiple oracles
- Price volatility tracking
- 60-second polling intervals
- Historical data retention (1000 updates per feed)
- Redis caching with expiration

**Supported Data Sources:**
- Stellar Oracle
- Chainlink
- Band Protocol
- Custom sources

**API Endpoints:**
```
POST   /api/blockchain/oracles/feeds/register    - Register data feed
POST   /api/blockchain/oracles/prices/register   - Register price feed
GET    /api/blockchain/oracles/prices/:symbol    - Get current price
GET    /api/blockchain/oracles/feeds/active      - List active feeds
```

### 4. Wallet Manager (`walletManager.js`)
- Generate new wallets
- Import existing wallets
- Wallet balance tracking
- Transaction history
- Secure key management (encrypted storage)
- Multi-wallet support per user
- Wallet locking/unlocking
- Export with password protection

**Key Features:**
- Stellar-native wallet support
- AES-256-CBC encryption for secret keys
- PBKDF2 password-based encryption for exports
- Balance caching (5-minute TTL)
- Transaction history per wallet

**API Endpoints:**
```
POST   /api/blockchain/wallets/generate         - Generate new wallet
POST   /api/blockchain/wallets/import           - Import existing wallet
GET    /api/blockchain/wallets/:walletId        - Get wallet details
GET    /api/blockchain/wallets/user/:userId     - Get user's wallets
GET    /api/blockchain/wallets/:id/transactions - Get transaction history
POST   /api/blockchain/wallets/:id/lock         - Lock wallet
POST   /api/blockchain/wallets/:id/unlock       - Unlock wallet
```

### 5. Event Monitor (`eventMonitor.js`)
- Track blockchain events and transactions
- Smart contract event monitoring
- Alert thresholds and triggers
- Event statistics and reporting
- Export capabilities (JSON/CSV)
- Time-based event queries
- Real-time event subscriptions

**Key Features:**
- Event severity levels (info, warn, error)
- Redis-backed event storage
- Sorted sets for time-based queries
- Alert condition monitoring
- Statistical analysis

**Tracked Events:**
- Smart contract deployments/upgrades
- Transaction submissions/confirmations
- Wallet creation/management
- Oracle data updates
- Security audit events

**API Endpoints:**
```
GET    /api/blockchain/events/recent          - Get recent events
GET    /api/blockchain/events/statistics      - Get event statistics
```

### 6. Gas Optimizer (`gasOptimizer.js`)
- Fee estimation for various priority levels
- Cost optimization strategies
- Speed optimization for urgent transactions
- Balanced approach recommendations
- Fee trend analysis
- Optimization strategy templates
- Cost vs. speed tradeoff analysis

**Priority Levels:**
- **Low**: 0.5x multiplier, 5-10 minutes
- **Standard**: 1.0x multiplier, 30-60 seconds
- **Priority**: 5.0x multiplier, 10-30 seconds
- **Urgent**: 10.0x multiplier, 5-10 seconds

**Key Features:**
- Operation batching analysis
- Redundancy detection
- Operation type efficiency analysis
- Dynamic fee trending

**API Endpoints:**
```
GET    /api/blockchain/gas/price                    - Current gas price
POST   /api/blockchain/gas/estimate-fee             - Estimate transaction fee
POST   /api/blockchain/gas/optimize/cost            - Optimize for cost
POST   /api/blockchain/gas/optimize/speed           - Optimize for speed
GET    /api/blockchain/gas/tradeoff/:opCount        - Cost vs speed analysis
```

### 7. Security Auditor (`securityAuditor.js`)
- Smart contract security audits
- Transaction validation and verification
- Vulnerability detection
- Wallet security scoring
- Audit logging and reporting
- Security rule registration

**Security Checks:**
- Unsafe pattern detection
- Access control verification
- Input validation checks
- Overflow vulnerability detection
- Reentrancy vulnerability detection
- Timestamp dependency analysis

**Key Features:**
- Comprehensive audit reporting
- Vulnerability categorization (low/medium/high/critical)
- Security scoring (0-100)
- Audit trail maintenance (50,000 max records)
- CSV export capability

**API Endpoints:**
```
POST   /api/blockchain/security/audit/contract    - Audit smart contract
POST   /api/blockchain/security/audit/transaction - Audit transaction
GET    /api/blockchain/security/audit/report      - Generate audit report
```

## Integration with Healthcare Insurance

The blockchain layer integrates seamlessly with healthcare insurance workflows:

### Premium Payments
- Immutable transaction records
- Multi-token support
- Automated fee handling
- Real-time settlement

### Insurance Claims
- Smart contract-based claim processing
- Event-driven notifications
- Audit trail for compliance
- Transparent status tracking

### Fraud Detection
- On-chain fraud detection rules
- Transaction pattern analysis
- Real-time alerts
- Security auditing

### Contributor Verification
- Blockchain-based identity verification
- Immutable verification records
- Zero-trust security model
- Compliance auditing

## Configuration

### Environment Variables

```env
# Stellar Configuration
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
STELLAR_NETWORK=TESTNET_NETWORK_PASSPHRASE

# Wallet Security
WALLET_ENCRYPTION_KEY=your-encryption-key

# Oracle Services
STELLAR_ORACLE_URL=https://api.stellar.org
CHAINLINK_ORACLE_URL=https://api.chain.link
BAND_ORACLE_URL=https://api.bandprotocol.com

# Debug Mode
DEBUG=false
```

### Redis Configuration

Blockchain layer uses Redis for caching:
- Compiled contracts: 24-hour TTL
- Deployed contracts: 1-year TTL
- Transaction data: 1-hour TTL
- Event data: 30-day TTL
- Wallet data: 24-hour TTL
- Oracle prices: 60-second TTL

## Usage Examples

### Deploy a Smart Contract

```javascript
const blockchainLayer = require('./blockchain');

const deploymentResult = await blockchainLayer.smartContracts.deployContract(
  'insurance-premium-handler',
  'GBXXXXXXXXXX',  // publicKey
  'SBXXXXXXXXXX',  // secretKey
  contractCode
);
```

### Register a Price Feed

```javascript
blockchainLayer.oracles.registerPriceFeed('XLM/USD', 'stellar');

// Subscribe to price updates
blockchainLayer.oracles.subscribeToPriceUpdates('XLM/USD', (priceData) => {
  console.log(`XLM/USD: ${priceData.price}`);
});
```

### Generate a Wallet

```javascript
const wallet = blockchainLayer.wallets.generateWallet(userId, 'patient-wallet');
// Returns: { walletId, publicKey, createdAt, status, balance, ... }
```

### Build and Submit a Transaction

```javascript
// Build transaction
const { txId, transaction } = await blockchainLayer.transactions.buildTransaction(
  senderPublicKey,
  [operation1, operation2],
  { fee: 100, timeout: 300 }
);

// Sign transaction
const signed = await blockchainLayer.transactions.signTransaction(txId, secretKey);

// Submit transaction
const result = await blockchainLayer.transactions.submitTransaction(txId, client);
```

### Audit a Smart Contract

```javascript
const auditResult = await blockchainLayer.security.auditSmartContract(
  contractCode,
  'insurance-premium-handler'
);

console.log(`Security Score: ${auditResult.securityScore}%`);
console.log(`Vulnerabilities: ${auditResult.vulnerabilities.length}`);
```

## Error Handling

All blockchain operations include comprehensive error handling:

```javascript
try {
  const result = await blockchainLayer.smartContracts.deployContract(...);
} catch (error) {
  logger.error(`Deployment failed: ${error.message}`);
  // Handle error appropriately
}
```

## Security Best Practices

1. **Secret Key Management**
   - Never expose secret keys in logs
   - Encrypt all stored secret keys
   - Use environment variables for sensitive data

2. **Transaction Validation**
   - Always verify transaction signatures
   - Audit all transactions before submission
   - Implement rate limiting

3. **Wallet Security**
   - Enable wallet locking for inactive periods
   - Implement multi-signature support when needed
   - Regular security audits

4. **Oracle Data Validation**
   - Always validate oracle data before using
   - Implement multiple data sources
   - Monitor for data anomalies

## Performance Optimization

1. **Caching Strategy**
   - All data cached in Redis with appropriate TTLs
   - Wallet balance cached for 5 minutes
   - Contract metadata cached for 24 hours

2. **Batch Processing**
   - Batch up to 1000 transactions
   - Reduce individual transaction overhead
   - Optimize network usage

3. **Gas Optimization**
   - Analyze fee trends
   - Suggest optimal priority levels
   - Detect and eliminate redundant operations

## Monitoring and Analytics

- Real-time event monitoring
- Transaction status tracking
- Performance metrics
- Security audit reports
- Gas price trends
- System health checks

## Compliance

The blockchain layer supports:
- Full audit trails
- Immutable transaction records
- Regulatory compliance reporting
- Zero-knowledge verification
- Smart contract security standards

## API Response Format

All endpoints return standardized JSON responses:

```json
{
  "success": true,
  "data": { /* response data */ },
  "timestamp": "2024-04-27T10:30:00Z",
  "error": null
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error message",
  "timestamp": "2024-04-27T10:30:00Z",
  "code": "ERROR_CODE"
}
```

## Future Enhancements

- Multi-chain support (Ethereum, Polygon, etc.)
- Cross-chain bridges
- Advanced DeFi integrations
- Native token staking
- Decentralized governance
- Layer 2 scaling solutions
- Advanced privacy features

## Support

For issues, questions, or feature requests related to the blockchain integration layer, please refer to the main project documentation or contact the development team.

---

**Version**: 1.0.0  
**Last Updated**: April 27, 2024  
**Maintained By**: Healthcare Platform Team
