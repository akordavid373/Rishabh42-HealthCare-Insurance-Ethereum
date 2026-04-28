#!/bin/bash

set -e

echo "Deploying Healthcare Insurance Platform to Kubernetes..."

# Create namespace
echo "Creating namespace..."
kubectl apply -f namespace.yaml

# Apply RBAC
echo "Applying RBAC..."
kubectl apply -f rbac.yaml

# Apply network policies
echo "Applying network policies..."
kubectl apply -f network-policy.yaml

# Deploy backend
echo "Deploying backend service..."
kubectl apply -f backend-deployment.yaml

# Deploy frontend
echo "Deploying frontend service..."
kubectl apply -f frontend-deployment.yaml

# Apply HPA
echo "Configuring auto-scaling..."
kubectl apply -f hpa.yaml

# Apply Istio configurations
echo "Configuring Istio service mesh..."
kubectl apply -f istio-gateway.yaml
kubectl apply -f istio-security.yaml
kubectl apply -f istio-telemetry.yaml

# Apply ingress
echo "Configuring ingress..."
kubectl apply -f ingress.yaml

echo "Deployment completed successfully!"
echo "Checking deployment status..."

kubectl get pods -n healthcare-insurance
kubectl get services -n healthcare-insurance
kubectl get ingress -n healthcare-insurance

echo "Access your application at: https://healthcare.example.com"
