#!/bin/bash

# Healthcare Drips - Stellar Contract Deployment Script

echo "🌟 Healthcare Drips - Stellar Contract Deployment"
echo "=================================================="

# Check if required environment variables are set
if [ -z "$SECRET_KEY" ]; then
    echo "❌ SECRET_KEY environment variable is not set"
    echo "Please set your Stellar secret key:"
    echo "export SECRET_KEY=your_secret_key"
    exit 1
fi

if [ -z "$PUBLIC_KEY" ]; then
    echo "❌ PUBLIC_KEY environment variable is not set"
    echo "Please set your Stellar public key:"
    echo "export PUBLIC_KEY=your_public_key"
    exit 1
fi

# Set network (default: testnet)
NETWORK=${STELLAR_NETWORK:-testnet}
RPC_URL=${STELLAR_RPC_URL:-https://soroban-testnet.stellar.org}

echo "📡 Network: $NETWORK"
echo "🔐 Deployer: $PUBLIC_KEY"
echo "🌐 RPC URL: $RPC_URL"

# Check if WASM file exists
WASM_FILE="target/wasm32v1-none/release/healthcare_drips.wasm"
if [ ! -f "$WASM_FILE" ]; then
    echo "❌ WASM file not found: $WASM_FILE"
    echo "Please build the contract first:"
    echo "chmod +x scripts/build.sh && ./scripts/build.sh"
    exit 1
fi

# Check if Soroban CLI is installed
if ! command -v soroban &> /dev/null; then
    echo "❌ Soroban CLI is not installed"
    echo "Installing Soroban CLI..."
    cargo install soroban-cli
fi

# Deploy contract
echo "🚀 Deploying Healthcare Drips contract..."
DEPLOY_OUTPUT=$(soroban contract deploy \
    --wasm "$WASM_FILE" \
    --source "$SECRET_KEY" \
    --network "$NETWORK" \
    --rpc-url "$RPC_URL" 2>&1)

if [ $? -eq 0 ]; then
    # Extract contract ID from output
    CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -o 'Contract ID: [a-zA-Z0-9]' | cut -d' ' -f3)
    
    if [ -z "$CONTRACT_ID" ]; then
        echo "❌ Could not extract contract ID from deployment output"
        echo "Deployment output:"
        echo "$DEPLOY_OUTPUT"
        exit 1
    fi
    
    echo "✅ Contract deployed successfully!"
    echo "📍 Contract ID: $CONTRACT_ID"
    
    # Initialize contract
    echo "⚙️ Initializing Healthcare Drips contract..."
    INIT_OUTPUT=$(soroban contract invoke \
        --id "$CONTRACT_ID" \
        --source "$SECRET_KEY" \
        --network "$NETWORK" \
        --rpc-url "$RPC_URL" \
        -- \
        initialize \
        --admin "$PUBLIC_KEY" 2>&1)
    
    if [ $? -eq 0 ]; then
        echo "✅ Contract initialized successfully!"
        
        # Save deployment info
        DEPLOYMENT_INFO=$(cat <<EOF
{
  "network": "$NETWORK",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "contract_id": "$CONTRACT_ID",
  "admin_address": "$PUBLIC_KEY",
  "platform": "Stellar/Soroban",
  "wasm_file": "$WASM_FILE",
  "rpc_url": "$RPC_URL"
}
EOF
        )
        
        echo "$DEPLOYMENT_INFO" > deployment.json
        echo "📋 Deployment info saved to deployment.json"
        
        # Verify deployment
        echo "🔍 Verifying deployment..."
        ADMIN_CHECK=$(soroban contract read \
            --id "$CONTRACT_ID" \
            --network "$NETWORK" \
            --rpc-url "$RPC_URL" \
            --method get_admin 2>/dev/null)
        
        if [ $? -eq 0 ]; then
            echo "✅ Contract verified successfully!"
            echo "👤 Admin address: $ADMIN_CHECK"
        else
            echo "⚠️ Could not verify contract deployment"
        fi
        
        echo ""
        echo "🎉 Deployment completed successfully!"
        echo ""
        echo "Contract Details:"
        echo "- Contract ID: $CONTRACT_ID"
        echo "- Admin Address: $PUBLIC_KEY"
        echo "- Network: $NETWORK"
        echo "- RPC URL: $RPC_URL"
        echo ""
        echo "Next steps:"
        echo "1. Update frontend with contract address:"
        echo "   export CONTRACT_ID=$CONTRACT_ID"
        echo ""
        echo "2. Test contract functions:"
        echo "   soroban contract invoke --id $CONTRACT_ID --source \$SECRET_KEY --network $NETWORK -- get_admin"
        echo ""
        echo "3. Start frontend:"
        echo "   cd frontend && npm start"
        
    else
        echo "❌ Contract initialization failed!"
        echo "Initialization output:"
        echo "$INIT_OUTPUT"
        exit 1
    fi
    
else
    echo "❌ Contract deployment failed!"
    echo "Deployment output:"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi
