# Healthcare Backend API

A comprehensive RESTful API for the Healthcare Patient Dashboard system with real-time updates, authentication, and optimized data retrieval.

## Features

- **JWT Authentication**: Secure token-based authentication system
- **RESTful API**: Complete CRUD operations for all healthcare data
- **Real-time Updates**: WebSocket integration for live notifications
- **Data Aggregation**: Optimized queries for dashboard performance
- **Rate Limiting**: Built-in protection against API abuse
- **Caching**: Redis/NodeCache integration for improved performance
- **Database Optimization**: Indexed SQLite database for fast queries

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - User logout

### Patients
- `GET /api/patients/dashboard/:patientId` - Get patient dashboard data
- `GET /api/patients/:patientId` - Get patient details
- `POST /api/patients` - Create new patient profile
- `PUT /api/patients/:patientId` - Update patient profile

### Medical Records
- `GET /api/medical-records/patient/:patientId` - Get patient medical records
- `GET /api/medical-records/:recordId` - Get specific medical record
- `POST /api/medical-records` - Create new medical record
- `PUT /api/medical-records/:recordId` - Update medical record
- `DELETE /api/medical-records/:recordId` - Delete medical record

### Insurance Claims
- `GET /api/claims/patient/:patientId` - Get patient claims
- `GET /api/claims/summary/:patientId` - Get claims summary
- `GET /api/claims/:claimId` - Get specific claim
- `POST /api/claims` - Create new claim
- `PUT /api/claims/:claimId/status` - Update claim status

### Appointments
- `GET /api/appointments/patient/:patientId` - Get patient appointments
- `GET /api/appointments/upcoming/:patientId` - Get upcoming appointments
- `GET /api/appointments/:appointmentId` - Get specific appointment
- `POST /api/appointments` - Schedule new appointment
- `PUT /api/appointments/:appointmentId` - Update appointment
- `DELETE /api/appointments/:appointmentId` - Cancel appointment

### Premium Payments
- `GET /api/payments/patient/:patientId` - Get patient payments
- `GET /api/payments/summary/:patientId` - Get payments summary
- `POST /api/payments` - Record new payment

## Installation

1. Install dependencies:
```bash
npm install
```

2. Copy environment variables:
```bash
cp .env.example .env
```

3. Edit `.env` file with your configuration:
```env
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=7d
DB_PATH=./database/healthcare.db
REDIS_URL=redis://localhost:6379
CACHE_TTL=300
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100
```

4. Start the server:
```bash
# Development
npm run dev

# Production
npm start
```

## Database Schema

The application uses SQLite with the following main tables:

- **users**: User authentication and profile data
- **patients**: Patient-specific medical information
- **medical_records**: Complete medical history
- **insurance_claims**: Insurance claim tracking
- **premium_payments**: Payment history
- **appointments**: Appointment scheduling
- **notifications**: System notifications

## WebSocket Events

The server emits real-time events for:

- `new-medical-record`: New medical record added
- `new-claim`: New insurance claim submitted
- `claim-status-update`: Claim status changed
- `new-appointment`: New appointment scheduled
- `appointment-updated`: Appointment modified
- `new-payment`: Payment recorded

## Authentication

All API endpoints (except authentication) require a valid JWT token:

```javascript
headers: {
  'Authorization': 'Bearer <your-jwt-token>'
}
```

## Rate Limiting

- **Window**: 15 minutes
- **Max Requests**: 100 per IP
- **Cache TTL**: 5 minutes (configurable)

## Error Handling

The API returns consistent error responses:

```json
{
  "error": "Error Type",
  "message": "Human readable error message",
  "details": "Additional error information (in development)"
}
```

## Performance Optimization

- Database indexes on frequently queried fields
- Response caching for GET requests
- Optimized aggregation queries
- Connection pooling
- Compression middleware

## Security Features

- JWT token authentication
- Password hashing with bcrypt
- Rate limiting
- CORS protection
- Helmet.js security headers
- Input validation and sanitization

## Development

The server includes comprehensive logging and error tracking. In development mode, detailed error information is returned for debugging.

## Testing

Run the test suite:
```bash
npm test
```

## License

MIT License - see LICENSE file for details.
