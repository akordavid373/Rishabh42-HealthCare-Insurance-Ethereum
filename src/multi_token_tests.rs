#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::{Address as TestAddress, Ledger as TestLedger}, Env, Address};

#[test]
fn test_multi_token_premium_drip_creation() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let patient = Address::generate(&env);
    let insurer = Address::generate(&env);
    let token1 = Address::generate(&env);
    let token2 = Address::generate(&env);
    let token3 = Address::generate(&env);

    // Initialize contract
    HealthcareDrips::initialize(&env, admin.clone());

    // Create token allocations (50% token1, 30% token2, 20% token3)
    let mut allocations = Vec::new(&env);
    allocations.push_back(TokenAllocation {
        token: token1.clone(),
        percentage: 5000, // 50%
        min_balance: 1000,
    });
    allocations.push_back(TokenAllocation {
        token: token2.clone(),
        percentage: 3000, // 30%
        min_balance: 500,
    });
    allocations.push_back(TokenAllocation {
        token: token3.clone(),
        percentage: 2000, // 20%
        min_balance: 200,
    });

    // Create premium drip with multi-token support
    let drip_id = HealthcareDrips::create_premium_drip(
        &env,
        patient.clone(),
        insurer.clone(),
        token1.clone(), // primary token
        1000, // premium amount
        allocations,
        86400 * 30, // 30 days interval
        true, // auto rebalance
        500, // 5% slippage tolerance
    ).unwrap();

    // Verify drip creation
    let drip = HealthcareDrips::get_premium_drip(&env, drip_id).unwrap();
    assert_eq!(drip.patient, patient);
    assert_eq!(drip.insurer, insurer);
    assert_eq!(drip.primary_token, token1);
    assert_eq!(drip.premium_amount, 1000);
    assert_eq!(drip.token_allocations.len(), 3);
    assert!(drip.auto_rebalance);
    assert_eq!(drip.slippage_tolerance, 500);
}

#[test]
fn test_token_allocation_validation() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let patient = Address::generate(&env);
    let insurer = Address::generate(&env);
    let token1 = Address::generate(&env);
    let token2 = Address::generate(&env);

    HealthcareDrips::initialize(&env, admin.clone());

    // Test invalid allocation (total != 100%)
    let mut invalid_allocations = Vec::new(&env);
    invalid_allocations.push_back(TokenAllocation {
        token: token1.clone(),
        percentage: 6000, // 60%
        min_balance: 1000,
    });
    invalid_allocations.push_back(TokenAllocation {
        token: token2.clone(),
        percentage: 3000, // 30% (total = 90%)
        min_balance: 500,
    });

    let result = HealthcareDrips::create_premium_drip(
        &env,
        patient.clone(),
        insurer.clone(),
        token1.clone(),
        1000,
        invalid_allocations,
        86400 * 30,
        true,
        500,
    );

    assert_eq!(result, Err(HealthcareDripsError::InvalidTokenAllocation));
}

#[test]
fn test_swap_request_creation() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token1 = Address::generate(&env);
    let token2 = Address::generate(&env);
    let caller = Address::generate(&env);

    HealthcareDrips::initialize(&env, admin.clone());

    let swap_id = HealthcareDrips::create_swap_request(
        &env,
        token1.clone(),
        token2.clone(),
        1000, // amount in
        970,  // min amount out (3% slippage)
        300,  // 3% slippage tolerance
        env.ledger().timestamp() + 3600, // 1 hour deadline
        caller.clone(),
    ).unwrap();

    // Verify swap request
    let swap = HealthcareDrips::get_swap_request(&env, swap_id).unwrap();
    assert_eq!(swap.from_token, token1);
    assert_eq!(swap.to_token, token2);
    assert_eq!(swap.amount_in, 1000);
    assert_eq!(swap.min_amount_out, 970);
    assert_eq!(swap.slippage_tolerance, 300);
    assert_eq!(swap.status, SwapStatus::Executed); // Should be executed immediately
}

#[test]
fn test_slippage_protection() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token1 = Address::generate(&env);
    let token2 = Address::generate(&env);
    let caller = Address::generate(&env);

    HealthcareDrips::initialize(&env, admin.clone());

    // Test with excessive slippage
    let result = HealthcareDrips::create_swap_request(
        &env,
        token1.clone(),
        token2.clone(),
        1000,
        900, // Expecting 10% slippage
        200, // But only allowing 2% slippage
        env.ledger().timestamp() + 3600,
        caller.clone(),
    );

    // Should fail due to slippage protection
    assert_eq!(result, Err(HealthcareDripsError::SlippageExceeded));
}

#[test]
fn test_token_balance_tracking() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let token = Address::generate(&env);

    HealthcareDrips::initialize(&env, admin.clone());

    // Initially no balance
    let result = HealthcareDrips::get_token_balance(&env, token.clone());
    assert_eq!(result, Err(HealthcareDripsError::InvalidToken));

    // Create a premium drip to initialize balance tracking
    let patient = Address::generate(&env);
    let insurer = Address::generate(&env);
    
    let mut allocations = Vec::new(&env);
    allocations.push_back(TokenAllocation {
        token: token.clone(),
        percentage: 10000, // 100%
        min_balance: 100,
    });

    HealthcareDrips::create_premium_drip(
        &env,
        patient,
        insurer,
        token.clone(),
        1000,
        allocations,
        86400 * 30,
        true,
        500,
    ).unwrap();

    // Now balance should be tracked
    let balance = HealthcareDrips::get_token_balance(&env, token.clone()).unwrap();
    assert_eq!(balance.token, token);
    assert_eq!(balance.balance, 0); // Initially zero
}

#[test]
fn test_rebalance_configuration() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    HealthcareDrips::initialize(&env, admin.clone());

    // Get default config
    let config = HealthcareDrips::get_rebalance_config(&env);
    assert!(config.enabled);
    assert_eq!(config.threshold, 1000); // 10%
    assert_eq!(config.max_slippage, 500); // 5%

    // Test unauthorized update
    let new_config = RebalanceConfig {
        enabled: false,
        threshold: 2000,
        max_slippage: 1000,
        check_interval: 43200,
        last_check: env.ledger().timestamp(),
    };

    let result = HealthcareDrips::update_rebalance_config(
        &env,
        new_config.clone(),
        non_admin.clone(),
    );
    assert_eq!(result, Err(HealthcareDripsError::Unauthorized));

    // Test authorized update
    HealthcareDrips::update_rebalance_config(&env, new_config.clone(), admin.clone()).unwrap();
    
    let updated_config = HealthcareDrips::get_rebalance_config(&env);
    assert!(!updated_config.enabled);
    assert_eq!(updated_config.threshold, 2000);
    assert_eq!(updated_config.max_slippage, 1000);
}

#[test]
fn test_multi_token_premium_payment() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let patient = Address::generate(&env);
    let insurer = Address::generate(&env);
    let token1 = Address::generate(&env);
    let token2 = Address::generate(&env);

    HealthcareDrips::initialize(&env, admin.clone());

    // Create multi-token drip
    let mut allocations = Vec::new(&env);
    allocations.push_back(TokenAllocation {
        token: token1.clone(),
        percentage: 6000, // 60%
        min_balance: 600,
    });
    allocations.push_back(TokenAllocation {
        token: token2.clone(),
        percentage: 4000, // 40%
        min_balance: 400,
    });

    let drip_id = HealthcareDrips::create_premium_drip(
        &env,
        patient.clone(),
        insurer.clone(),
        token1.clone(),
        1000,
        allocations,
        86400 * 30,
        true,
        500,
    ).unwrap();

    // Advance time to make payment due
    env.ledger().set_timestamp(env.ledger().timestamp() + 86400 * 30 + 1);

    // Test unauthorized payment
    let result = HealthcareDrips::process_multi_token_premium_payment(
        &env,
        drip_id,
        patient.clone(), // Not insurer
    );
    assert_eq!(result, Err(HealthcareDripsError::Unauthorized));

    // Test authorized payment
    HealthcareDrips::process_multi_token_premium_payment(
        &env,
        drip_id,
        insurer.clone(),
    ).unwrap();

    // Verify payment was processed
    let drip = HealthcareDrips::get_premium_drip(&env, drip_id).unwrap();
    assert_eq!(drip.total_paid, 1000);
    assert!(drip.next_payment > drip.last_payment);
}

#[test]
fn test_auto_rebalancing() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let patient = Address::generate(&env);
    let insurer = Address::generate(&env);
    let token1 = Address::generate(&env);
    let token2 = Address::generate(&env);

    HealthcareDrips::initialize(&env, admin.clone());

    // Create multi-token drip with auto-rebalance
    let mut allocations = Vec::new(&env);
    allocations.push_back(TokenAllocation {
        token: token1.clone(),
        percentage: 5000, // 50%
        min_balance: 500,
    });
    allocations.push_back(TokenAllocation {
        token: token2.clone(),
        percentage: 5000, // 50%
        min_balance: 500,
    });

    HealthcareDrips::create_premium_drip(
        &env,
        patient.clone(),
        insurer.clone(),
        token1.clone(),
        1000,
        allocations,
        86400 * 30,
        true, // Enable auto-rebalance
        500,
    ).unwrap();

    // Test rebalance checking
    let result = HealthcareDrips::check_and_rebalance(&env);
    assert_eq!(result, Ok(())); // Should succeed even if no rebalancing needed
}
