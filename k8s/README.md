# Healthcare Insurance Platform - Kubernetes Deployment

This directory contains the complete Kubernetes orchestration setup for the Healthcare Insurance Platform with auto-scaling and service mesh capabilities.

## Prerequisites

- Kubernetes cluster (v1.24+)
- kubectl configured
- Istio installed
- NGINX Ingress Controller
- Cert-manager (for SSL certificates)
- Container registry access

## Architecture

### Components
- **Backend**: Node.js API server with auto-scaling
- **Frontend**: React application served by NGINX
- **Service Mesh**: Istio for traffic management, security, and observability
- **Auto-scaling**: Horizontal Pod Autoscaler (HPA) for both services
- **Security**: Network policies, RBAC, and mTLS

### Features Implemented

✅ **Kubernetes Deployment**
- Backend and frontend deployments with proper resource management
- Service discovery with ClusterIP services
- Dedicated namespace with Istio injection enabled

✅ **Auto-scaling Configuration**
- HPA for both backend (3-10 replicas) and frontend (2-8 replicas)
- CPU and memory-based scaling metrics
- Configurable scale-up and scale-down policies

✅ **Service Mesh Integration**
- Istio gateway for external access
- Virtual services for traffic routing
- Destination rules with circuit breakers and load balancing
- mTLS encryption between services

✅ **Health Checks**
- Liveness and readiness probes for all containers
- Proper health check endpoints
- Graceful startup and shutdown handling

✅ **Rolling Updates**
- Zero-downtime deployment strategy
- Configurable maxUnavailable and maxSurge settings
- Progressive rollout with health verification

✅ **Resource Management**
- CPU and memory requests/limits defined
- Resource optimization for cost efficiency
- QoS classes properly configured

✅ **Security Policies**
- Network policies restricting traffic flow
- RBAC with least privilege principle
- Pod security contexts and non-root users
- mTLS with Istio security policies

## Deployment Steps

1. **Build and push container images:**
```bash
# Backend
cd backend
docker build -t healthcare-backend:latest .
docker push healthcare-backend:latest

# Frontend
cd frontend
docker build -t healthcare-frontend:latest .
docker push healthcare-frontend:latest
```

2. **Deploy the application:**
```bash
cd k8s
chmod +x deploy.sh
./deploy.sh
```

3. **Verify deployment:**
```bash
kubectl get pods -n healthcare-insurance
kubectl get services -n healthcare-insurance
kubectl get ingress -n healthcare-insurance
```

## Monitoring and Observability

### Metrics
- Prometheus integration for metrics collection
- Custom metrics for application performance
- HPA metrics for auto-scaling visibility

### Logging
- Structured logging with context
- Centralized log collection through Istio
- Access logs for security auditing

### Tracing
- Jaeger integration for distributed tracing
- Request correlation across services
- Performance bottleneck identification

## Security Features

- **Network Isolation**: Network policies prevent unauthorized access
- **Encryption**: mTLS for all inter-service communication
- **Authentication**: Service-to-service authentication with Istio
- **Authorization**: Fine-grained access control policies
- **Container Security**: Non-root users, read-only filesystems

## Scaling Configuration

### Backend Auto-scaling
- Min replicas: 3
- Max replicas: 10
- CPU threshold: 70%
- Memory threshold: 80%

### Frontend Auto-scaling
- Min replicas: 2
- Max replicas: 8
- CPU threshold: 70%
- Memory threshold: 80%

## Traffic Management

- **Load Balancing**: Least connection algorithm
- **Circuit Breaking**: Automatic failover for unhealthy instances
- **Retries**: Configurable retry policies for resilience
- **Timeouts**: Appropriate timeout settings for different endpoints

## Disaster Recovery

- **Health Checks**: Automatic pod restart on failures
- **Rolling Updates**: Ability to rollback quickly
- **Multi-replica**: High availability across nodes
- **Graceful Shutdown**: Proper connection draining

## Cost Optimization

- **Resource Limits**: Prevent resource waste
- **Auto-scaling**: Scale down during low traffic
- **Efficient Scheduling**: Pod affinity and anti-affinity
- **Monitoring**: Resource usage tracking

## Troubleshooting

### Common Issues

1. **Pods not starting**: Check resource limits and node capacity
2. **Service not accessible**: Verify network policies and service configuration
3. **Auto-scaling not working**: Ensure metrics server is running
4. **SSL certificate errors**: Check cert-manager configuration

### Debug Commands

```bash
# Check pod logs
kubectl logs -f deployment/healthcare-backend -n healthcare-insurance

# Check events
kubectl get events -n healthcare-insurance --sort-by='.lastTimestamp'

# Check HPA status
kubectl describe hpa healthcare-backend-hpa -n healthcare-insurance

# Check Istio configuration
kubectl get virtualservices -n healthcare-insurance
kubectl get destinationrules -n healthcare-insurance
```

## Maintenance

### Updates
- Use rolling updates for zero downtime
- Test in staging environment first
- Monitor metrics during deployment

### Backup
- Regular etcd backups
- Configuration version control
- Disaster recovery testing

## Compliance

This deployment follows Kubernetes best practices and security standards:
- CIS Kubernetes Benchmark compliance
- GDPR-ready data handling
- HIPAA-compatible security measures
- SOC 2 Type II preparation
