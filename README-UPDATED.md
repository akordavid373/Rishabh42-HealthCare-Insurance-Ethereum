# 🌟 Healthcare Drips - Medical Insurance Platform on Stellar

A modern Web3 healthcare platform built on **Stellar/Soroban** that enables **recurring insurance premium payments** and **contributor-driven issue management** for medical insurance claims.

## 🎯 Why Stellar?

Healthcare Drips is built on **Stellar** for:

- ⚡ **Lightning-fast transactions** (5-second blocks)
- 💰 **Ultra-low fees** (~$0.01 per transaction)
- 🔐 **Native multi-signature** support
- 🌍 **Global accessibility** with built-in DEX
- 🚀 **High throughput** (400+ TPS)

## 🏗️ Architecture

```
healthcare-drips/
├── 📦 src/                           # Stellar smart contracts
│   ├── healthcare_drips.rs           # Main contract logic
│   ├── lib.rs                        # Module exports
│   ├── main.rs                       # Entry point
│   └── tests.rs                      # Comprehensive tests
├── 🌐 frontend/                      # React dApp with Stellar SDK
├── ⚙️ scripts/                       # Deployment and utilities
├── 📖 docs/                          # Documentation
├── 📋 .github/                       # Issue templates
└── 📦 Cargo.toml                    # Rust project configuration
```

## 🔧 Key Features

### 🏥 **Insurance Premium Drips**

- **Automated recurring payments** for insurance premiums
- **Flexible payment schedules** (daily, weekly, monthly)
- **Multi-token support** (XLM, USDC, custom tokens)
- **Emergency pause** functionality
- **Stellar native token transfers**

### 👥 **Contributor Governance**

- **Issue-based funding** for medical treatments
- **Community voting** on claim approvals
- **Reputation system** with 5 levels
- **Transparent decision making**
- **Stellar multi-sig approvals**

### 🛡️ **Stellar Security Features**

- **Native multi-signature** for large claims
- **Role-based access** control
- **Atomic operations** guarantee
- **Built-in replay protection**
- **Bounded execution** limits

### 📱 **Modern Frontend**

- **React-based** with Stellar SDK
- **Freighter wallet** integration
- **Real-time updates** for claim status
- **Mobile responsive** design

## 🚀 Quick Start

### Prerequisites

- Rust 1.70+
- Soroban CLI
- Stellar account with XLM
- Freighter wallet (for frontend)

### Build Contract

```bash
# Build the Stellar contract
cargo build --target wasm32v1-none --release

# Run tests
cargo test
```

### Deploy to Testnet

```bash
# Install Soroban CLI
cargo install soroban-cli

# Deploy contract
soroban contract deploy \
  --wasm target/wasm32v1-none/release/healthcare_drips.wasm \
  --source your_secret_key \
  --network testnet

# Initialize contract
soroban contract invoke \
  --id <CONTRACT_ID> \
  --source your_secret_key \
  -- \
  initialize \
  --admin your_public_key
```

### Frontend Setup

```bash
cd frontend
npm install
npm start
```

## 💰 Use Cases

### 1. **Insurance Premium Drips**

```rust
// Create recurring premium payment
HealthcareDrips::create_premium_drip(
    &env,
    patient_address,
    insurer_address,
    token_address,
    500_i128, // 5 XLM monthly
    2592000_u64, // 30 days
);
```

### 2. **Contributor Issue Funding**

```rust
// Create medical treatment funding request
HealthcareDrips::create_issue(
    &env,
    patient_address,
    IssueType::Surgery,
    "Emergency Surgery".to_string(),
    "Patient needs immediate surgery".to_string(),
    10000_i128, // 100 XLM
    "QmHash123".to_string(),
    deadline_timestamp,
    3_u32, // Required approvals
    creator_address,
);
```

### 3. **Claim Processing**

```rust
// Multi-sig claim approval
HealthcareDrips::review_application(
    &env,
    issue_id,
    contributor_address,
    true, // Approved
    "Good expertise match".to_string(),
    reviewer_address,
);
```

## 🏛️ Smart Contract Structure

### **Core Types**

```rust
// Issue Types
pub enum IssueType {
    EmergencyTreatment = 0,
    Surgery = 1,
    PreventiveCare = 2,
    ChronicCondition = 3,
    MentalHealth = 4,
    Rehabilitation = 5,
    MedicalEquipment = 6,
    ResearchFunding = 7,
}

// Contributor Levels
pub enum ContributorLevel {
    Junior = 0,      // 1-5 contributions
    Intermediate = 1, // 6-15 contributions
    Senior = 2,       // 16-30 contributions
    Expert = 3,       // 31-50 contributions
    Master = 4,       // 51+ contributions
}
```

### **Key Functions**

- `create_premium_drip()` - Setup recurring payments
- `process_premium_payment()` - Execute payments
- `create_issue()` - Create funding requests
- `apply_to_issue()` - Contributor applications
- `review_application()` - Multi-sig reviews
- `verify_contributor()` - Contributor verification

### **Access Control**

- **ISSUE_CREATOR**: Can create issues
- **REVIEWER**: Can review applications
- **APPROVER**: Can approve issues
- **CONTRIBUTOR**: Can apply to issues

## 🌐 Frontend Integration

### **Stellar SDK Setup**

```typescript
import { SorobanRpc, Contract, Address } from "@stellar/stellar-sdk";

// Initialize
const rpc = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const contract = new Contract(contractAddress);

// Call contract
const result = await contract.call("create_premium_drip", [
  patientAddress.toScVal(),
  insurerAddress.toScVal(),
  tokenAddress.toScVal(),
  ScVal.scvI128(premiumAmount),
  ScVal.scvU64(interval),
]);
```

### **Freighter Wallet**

```typescript
// Connect wallet
const wallet = window.freighter;
const publicKey = await wallet.getPublicKey();

// Sign transaction
const signedTx = await wallet.signTransaction(transaction);
```

## 📊 Performance Benefits

| Feature              | Ethereum | Stellar  | Improvement   |
| -------------------- | -------- | -------- | ------------- |
| **Transaction Fees** | $20-100  | ~$0.01   | 99.9% cheaper |
| **Block Time**       | ~15s     | ~5s      | 3x faster     |
| **Throughput**       | ~15 TPS  | ~400 TPS | 25x higher    |
| **Multi-sig**        | Custom   | Native   | Built-in      |
| **Finality**         | ~1 min   | ~10s     | 6x faster     |

## 🎯 Issue Types & Acceptance Criteria

### **1. EMERGENCY_TREATMENT** 🚨

- **Funding**: 1,000-50,000 XLM
- **Approvals**: 3 (Medical, Financial, Community)
- **Timeline**: 24-48 hours

### **2. SURGERY** 🏥

- **Funding**: 5,000-100,000 XLM
- **Approvals**: 4 (Medical, Hospital, Financial, Community)
- **Timeline**: 3-5 business days

### **3. PREVENTIVE_CARE** 🛡️

- **Funding**: 500-10,000 XLM
- **Approvals**: 2 (Medical, Community)
- **Timeline**: 2-3 business days

### **4. CHRONIC_CONDITION** ⏳

- **Funding**: 2,000-20,000 XLM/year
- **Approvals**: 3 (Medical, Financial, Community)
- **Timeline**: 5-7 business days

### **5. MENTAL_HEALTH** 🧠

- **Funding**: 1,000-15,000 XLM
- **Approvals**: 3 (Mental Health, Financial, Community)
- **Timeline**: 3-4 business days

### **6. REHABILITATION** 💪

- **Funding**: 3,000-25,000 XLM
- **Approvals**: 3 (Medical, Financial, Community)
- **Timeline**: 4-5 business days

### **7. MEDICAL_EQUIPMENT** 🏥

- **Funding**: 500-20,000 XLM
- **Approvals**: 2 (Medical, Financial)
- **Timeline**: 2-3 business days

### **8. RESEARCH_FUNDING** 🔬

- **Funding**: 10,000-200,000 XLM
- **Approvals**: 5 (Scientific, Ethical, Financial, Community, Medical)
- **Timeline**: 7-14 business days

## 🏆 Contributor Rewards

### **Reputation System**

- **Application Review**: +5 points
- **Approved Application**: +10 points
- **Successful Contribution**: +20 points
- **Exceptional Impact**: +50 points

### **Level Benefits**

- **Junior**: 10 HCT per approved application
- **Intermediate**: 25 HCT per approved application
- **Senior**: 50 HCT per approved application
- **Expert**: 100 HCT per approved application
- **Master**: 200 HCT per approved application

## 🧪 Testing

### **Run Tests**

```bash
# Unit tests
cargo test

# Integration tests
cargo test -- --nocapture

# Specific test
cargo test test_create_premium_drip
```

### **Test Coverage**

- ✅ Contract initialization
- ✅ Premium drip creation and processing
- ✅ Issue management workflow
- ✅ Contributor verification system
- ✅ Application and review process
- ✅ Access control and permissions
- ✅ Error handling and edge cases

## 🔒 Security Features

### **Stellar Security**

- **Native Multi-sig**: Built-in multi-signature support
- **Atomic Operations**: Transaction atomicity guaranteed
- **Time-locks**: Built-in time-lock operations
- **Bounded Execution**: Gas limits prevent infinite loops
- **Replay Protection**: Sequence numbers prevent replay attacks

### **Contract Security**

- **Role-based Access**: Granular permission control
- **Input Validation**: Comprehensive parameter checking
- **Error Handling**: Proper error propagation
- **Audit Trail**: Complete transaction history

## 📱 Frontend Features

### **Patient Dashboard**

- View active premium drips
- Submit funding requests
- Track claim status
- Manage payment methods

### **Contributor Portal**

- Browse funding opportunities
- Vote on claim approvals
- Track reputation score
- Earn rewards

### **Admin Panel**

- Manage system settings
- Override emergency claims
- Generate compliance reports
- Monitor platform health

## 🚀 Deployment

### **Testnet Deployment**

```bash
# Build contract
cargo build --target wasm32v1-none --release

# Deploy to testnet
soroban contract deploy \
  --wasm target/wasm32v1-none/release/healthcare_drips.wasm \
  --source $SECRET_KEY \
  --network testnet

# Initialize
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  -- initialize --admin $PUBLIC_KEY
```

### **Mainnet Deployment**

```bash
# Deploy to mainnet
soroban contract deploy \
  --wasm target/wasm32v1-none/release/healthcare_drips.wasm \
  --source $SECRET_KEY \
  --network public

# Initialize with enhanced security
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  -- initialize --admin $PUBLIC_KEY
```

### **CI/CD Pipeline**

- Automated pipeline: [.github/workflows/ci-cd.yml](.github/workflows/ci-cd.yml)
- Security scanning: [.github/workflows/codeql.yml](.github/workflows/codeql.yml)
- Deployment manifests: `deployment.json` and `deployments/<environment>/`
- Rollback support: rerun the deployment workflow with `action=rollback` and a known-good `release_version`

See [docs/CI-CD-PIPELINE.md](docs/CI-CD-PIPELINE.md) for the full release and rollback flow.

## 📋 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md).

### **Development Flow**

1. Fork this repository
2. Create feature branch
3. Implement with tests
4. Submit pull request
5. Earn HCT rewards

## 📜 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

## 🔗 Links

- **GitHub Repository**: https://github.com/akordavid373/Rishabh42-HealthCare-Insurance-Stellar
- **Stellar Documentation**: https://soroban.stellar.org/docs/
- **Soroban SDK**: https://github.com/stellar/rs-soroban-sdk
- **Freighter Wallet**: https://freighter.app/

## 🙏 Acknowledgments

- **Stellar Development Foundation** for the Soroban platform
- **Stellar Community** for support and feedback
- **Open-source contributors** for making healthcare accessible

---

## 🎯 Roadmap

### **Q1 2024**

- [x] Stellar contract development
- [x] Comprehensive testing suite
- [x] Frontend integration
- [ ] Testnet deployment
- [ ] Community beta testing

### **Q2 2024**

- [ ] Mainnet deployment
- [ ] Mobile app development
- [ ] Advanced features
- [ ] Healthcare partnerships

### **Q3 2024**

- [ ] DeFi integrations
- [ ] Advanced analytics
- [ ] API for third parties
- [ ] Global expansion

---

**Join us in revolutionizing healthcare insurance with Stellar technology!** 🌟💫

## 📋 Platform Status

- **✅ Smart Contracts**: Complete and tested
- **✅ Frontend Integration**: Stellar SDK ready
- **✅ Documentation**: Comprehensive guides
- **✅ Testing**: Full test coverage
- **✅ Deployment**: Testnet ready

**The Healthcare Drips platform is now ready for production deployment on Stellar with lightning-fast transactions and ultra-low fees!** 🚀
