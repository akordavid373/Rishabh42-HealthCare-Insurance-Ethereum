#!/bin/bash

# Healthcare Drips - Stellar Contract Build Script

echo "🌟 Healthcare Drips - Stellar Contract Build"
echo "============================================"

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust is not installed. Please install Rust first."
    echo "Visit: https://rustup.rs/"
    exit 1
fi

# Check if Soroban CLI is installed
if ! command -v soroban &> /dev/null; then
    echo "❌ Soroban CLI is not installed. Installing..."
    cargo install soroban-cli
fi

# Check if wasm32v1-none target is installed
if ! rustup target list --installed | grep -q wasm32v1-none; then
    echo "📦 Installing wasm32v1-none target..."
    rustup target add wasm32v1-none
fi

# Build the contract
echo "🔨 Building Healthcare Drips contract..."
cargo build --target wasm32v1-none --release

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ Contract built successfully!"
    echo "📦 WASM file: target/wasm32v1-none/release/healthcare_drips.wasm"
    
    # Show file size
    WASM_SIZE=$(wc -c < target/wasm32v1-none/release/healthcare_drips.wasm)
    echo "📊 File size: $WASM_SIZE bytes"
    
    # Run tests
    echo "🧪 Running tests..."
    cargo test
    
    if [ $? -eq 0 ]; then
        echo "✅ All tests passed!"
    else
        echo "❌ Some tests failed!"
        exit 1
    fi
else
    echo "❌ Build failed!"
    exit 1
fi

echo ""
echo "🚀 Build completed successfully!"
echo ""
echo "Next steps:"
echo "1. Deploy to testnet:"
echo "   soroban contract deploy --wasm target/wasm32v1-none/release/healthcare_drips.wasm --source \$SECRET_KEY --network testnet"
echo ""
echo "2. Initialize contract:"
echo "   soroban contract invoke --id \$CONTRACT_ID --source \$SECRET_KEY -- initialize --admin \$PUBLIC_KEY"
echo ""
echo "3. Start frontend:"
echo "   cd frontend && npm start"
