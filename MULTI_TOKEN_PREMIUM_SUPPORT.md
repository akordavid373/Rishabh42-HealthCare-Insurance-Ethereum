# Multi-Token Premium Support

## Overview

This enhancement enables premium payments in multiple tokens simultaneously with automatic conversion through Stellar DEX. The implementation provides comprehensive multi-token support with automatic rebalancing, slippage protection, and real-time balance monitoring.

## Features

### 1. Multi-Token Allocation
- **Token Allocation Percentages**: Define exact percentage allocations for each token in a premium drip
- **Flexible Configuration**: Support for any number of tokens with custom percentage splits
- **Validation**: Automatic validation ensuring allocations sum to 100%
- **Minimum Balance Requirements**: Per-token minimum balance settings

### 2. Stellar DEX Integration
- **Automatic Token Conversion**: Seamless conversion between tokens using Stellar DEX
- **Real-time Price Queries**: Integration with DEX for accurate pricing
- **Swap Request Management**: Complete lifecycle management of swap operations
- **Transaction Tracking**: Full audit trail of all conversion operations

### 3. Slippage Protection
- **Configurable Tolerance**: Per-drip slippage tolerance settings
- **Pre-execution Validation**: Slippage checks before swap execution
- **Automatic Cancellation**: Failed swaps due to excessive slippage
- **Safety Mechanisms**: Protection against unfavorable market conditions

### 4. Token Balance Monitoring
- **Real-time Tracking**: Continuous monitoring of all token balances
- **USD Value Estimation**: Automatic valuation of token holdings
- **Balance History**: Complete audit trail of balance changes
- **Threshold Alerts**: Configurable alerts for low balances

### 5. Auto-Rebalancing
- **Automatic Rebalancing**: Periodic rebalancing to maintain target allocations
- **Deviation Detection**: Automatic detection of allocation deviations
- **Intelligent Swapping**: Efficient swapping to rebalance portfolios
- **Configurable Parameters**: Customizable rebalancing thresholds and intervals

## Technical Implementation

### New Data Structures

#### TokenAllocation
```rust
pub struct TokenAllocation {
    pub token: Address,
    pub percentage: u32,        // Basis points (10000 = 100%)
    pub min_balance: i128,
}
```

#### PremiumDrip (Enhanced)
```rust
pub struct PremiumDrip {
    pub id: u64,
    pub patient: Address,
    pub insurer: Address,
    pub primary_token: Address,
    pub premium_amount: i128,
    pub token_allocations: Vec<TokenAllocation>,
    pub interval: u64,
    pub last_payment: u64,
    pub next_payment: u64,
    pub active: bool,
    pub total_paid: i128,
    pub created: u64,
    pub auto_rebalance: bool,
    pub slippage_tolerance: u32,  // Basis points
}
```

#### SwapRequest
```rust
pub struct SwapRequest {
    pub id: u64,
    pub from_token: Address,
    pub to_token: Address,
    pub amount_in: i128,
    pub min_amount_out: i128,
    pub slippage_tolerance: u32,
    pub deadline: u64,
    pub status: SwapStatus,
    pub executed_amount: i128,
    pub created: u64,
    pub executed: u64,
}
```

#### TokenBalance
```rust
pub struct TokenBalance {
    pub token: Address,
    pub balance: i128,
    pub last_updated: u64,
    pub value_usd: i128,
}
```

#### RebalanceConfig
```rust
pub struct RebalanceConfig {
    pub enabled: bool,
    pub threshold: u32,           // Percentage deviation before rebalancing
    pub max_slippage: u32,
    pub check_interval: u64,
    pub last_check: u64,
}
```

### Key Functions

#### Premium Drip Management
- `create_premium_drip()` - Create multi-token premium drip with allocations
- `process_multi_token_premium_payment()` - Process payments across multiple tokens
- `cancel_premium_drip()` - Cancel premium drip

#### DEX Integration
- `create_swap_request()` - Create and execute token swap request
- `execute_swap()` - Execute swap with slippage protection
- `get_swap_amount_out()` - Query expected swap amounts

#### Balance Monitoring
- `update_token_balance()` - Update token balance tracking
- `get_token_balance()` - Retrieve current token balance
- `get_all_token_balances()` - Get all tracked token balances

#### Auto-Rebalancing
- `check_and_rebalance()` - Check and perform rebalancing
- `rebalance_drip_tokens()` - Rebalance specific premium drip
- `perform_rebalancing_swaps()` - Execute rebalancing swaps

#### Configuration Management
- `get_rebalance_config()` - Retrieve rebalancing configuration
- `update_rebalance_config()` - Update rebalancing settings

## Usage Examples

### Creating a Multi-Token Premium Drip

```rust
// Define token allocations (50% USDC, 30% USDT, 20% DAI)
let mut allocations = Vec::new(&env);
allocations.push_back(TokenAllocation {
    token: usdc_address,
    percentage: 5000,  // 50%
    min_balance: 1000,
});
allocations.push_back(TokenAllocation {
    token: usdt_address,
    percentage: 3000,  // 30%
    min_balance: 600,
});
allocations.push_back(TokenAllocation {
    token: dai_address,
    percentage: 2000,  // 20%
    min_balance: 400,
});

// Create premium drip
let drip_id = HealthcareDrips::create_premium_drip(
    &env,
    patient_address,
    insurer_address,
    usdc_address,  // Primary token
    1000,         // $1000 premium
    allocations,
    86400 * 30,   // 30 days interval
    true,         // Enable auto-rebalance
    500,          // 5% slippage tolerance
)?;
```

### Processing Multi-Token Premium Payment

```rust
// Process premium payment (automatically handles token conversions)
HealthcareDrips::process_multi_token_premium_payment(
    &env,
    drip_id,
    insurer_address,
)?;
```

### Manual Token Swap

```rust
// Create swap request
let swap_id = HealthcareDrips::create_swap_request(
    &env,
    usdc_address,
    usdt_address,
    500,          // Amount in
    485,          // Minimum amount out (3% slippage)
    300,          // 3% slippage tolerance
    env.ledger().timestamp() + 3600,  // 1 hour deadline
    caller_address,
)?;
```

### Configuring Auto-Rebalancing

```rust
let rebalance_config = RebalanceConfig {
    enabled: true,
    threshold: 1000,      // 10% deviation threshold
    max_slippage: 500,    // 5% max slippage
    check_interval: 86400, // Daily checks
    last_check: env.ledger().timestamp(),
};

HealthcareDrips::update_rebalance_config(
    &env,
    rebalance_config,
    admin_address,
)?;
```

## Error Handling

### New Error Types
- `InvalidTokenAllocation` - Token allocations don't sum to 100%
- `SlippageExceeded` - Swap slippage exceeds tolerance
- `InsufficientLiquidity` - Insufficient DEX liquidity
- `ConversionFailed` - Token conversion failed
- `RebalanceFailed` - Auto-rebalancing operation failed

### Error Recovery
- Automatic retry mechanisms for failed swaps
- Fallback to primary token when conversions fail
- Manual intervention capabilities for administrators

## Security Considerations

### Slippage Protection
- Pre-execution slippage validation
- Configurable tolerance limits
- Automatic cancellation of unfavorable swaps

### Access Control
- Admin-only configuration changes
- Insurer-only payment processing
- Role-based access to sensitive operations

### Audit Trail
- Complete transaction history
- Swap request tracking
- Balance change logging

## Testing

The implementation includes comprehensive tests covering:
- Multi-token drip creation and validation
- Swap request execution and slippage protection
- Token balance tracking and monitoring
- Auto-rebalancing functionality
- Error handling and edge cases

Run tests with:
```bash
cargo test --package healthcare-drips --lib multi_token_tests
```

## Future Enhancements

### Planned Features
- Integration with price oracles for real-time USD valuation
- Advanced rebalancing strategies (e.g., threshold-based, time-based)
- Support for liquidity provider tokens
- Gas optimization for batch operations

### Performance Optimizations
- Batch swap operations
- Caching for frequently accessed data
- Optimized storage patterns

## Migration Guide

### From Single-Token to Multi-Token
1. Existing drips continue to work with single-token configuration
2. New drips can be created with multi-token allocations
3. Manual migration available for existing drips

### Configuration Updates
- Update rebalancing settings as needed
- Configure slippage tolerances per risk profile
- Set up monitoring and alerting

## Support

For technical support or questions regarding the multi-token premium support feature:
- Review the test cases for usage examples
- Check the error documentation for troubleshooting
- Contact the development team for advanced configurations

---

**Note**: This implementation uses mock Stellar DEX integration for demonstration purposes. In production, replace the mock `get_swap_amount_out()` function with actual Stellar DEX API calls.
