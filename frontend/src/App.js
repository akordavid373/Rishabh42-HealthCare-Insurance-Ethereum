import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import detectEthereumProvider from '@metamask/detect-provider';
import {
  Heart,
  Users,
  TrendingUp,
  Calendar,
  Shield,
  CreditCard,
  Activity,
  DollarSign,
  Clock,
  CheckCircle,
  AlertCircle,
  UserPlus,
  FileText,
  Award,
  Database,
  Lock,
  Cpu,
  CreditCard as CreditIcon
} from 'lucide-react';
import './App.css';
import MedicalRecordManager from './components/MedicalRecordManager';
import MFASystem from './components/MFASystem';
import ClaimEngine from './components/ClaimEngine';
import PaymentGateways from './components/PaymentGateways';
import PatientDashboard from './components/PatientDashboard';

// Contract ABIs (simplified for demo)
const HEALTHCARE_DRIPS_ABI = [
  {
    "inputs": [
      {"internalType": "address", "name": "_patient", "type": "address"},
      {"internalType": "address", "name": "_insurer", "type": "address"},
      {"internalType": "address", "name": "_token", "type": "address"},
      {"internalType": "uint256", "name": "_premiumAmount", "type": "uint256"},
      {"internalType": "uint256", "name": "_interval", "type": "uint256"}
    ],
    "name": "createPremiumDrip",
    "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

function App() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [contract, setContract] = useState(null);
  const [premiumDrips, setPremiumDrips] = useState([]);
  const [fundingRequests, setFundingRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Contract addresses (would come from deployment.json)
  const CONTRACT_ADDRESS = "0x..."; // Replace with actual address

  useEffect(() => {
    connectWallet();
  }, []);

  const connectWallet = async () => {
    try {
      const ethereumProvider = await detectEthereumProvider();
      if (ethereumProvider) {
        const accounts = await ethereumProvider.request({ method: 'eth_requestAccounts' });
        const provider = new ethers.providers.Web3Provider(ethereumProvider);
        const signer = provider.getSigner();
        const contract = new ethers.Contract(CONTRACT_ADDRESS, HEALTHCARE_DRIPS_ABI, signer);
        
        setAccount(accounts[0]);
        setProvider(provider);
        setContract(contract);
        
        // Load initial data
        await loadUserData(contract, accounts[0]);
      }
    } catch (error) {
      console.error('Error connecting wallet:', error);
    }
  };

  const loadUserData = async (contract, userAddress) => {
    try {
      // Load user's premium drips
      const drips = await contract.getPatientPremiumDrips(userAddress);
      setPremiumDrips(drips);
      
      // Load active funding requests
      const requests = await contract.getActiveFundingRequests();
      setFundingRequests(requests);
    } catch (error) {
      console.error('Error loading user data:', error);
    }
  };

  const createPremiumDrip = async () => {
    if (!contract) return;
    
    try {
      setLoading(true);
      const tx = await contract.createPremiumDrip(
        account, // patient
        "0x...", // insurer (would be input)
        "0x...", // token address
        ethers.utils.parseEther("0.5"), // $500 monthly premium
        30 * 24 * 60 * 60 // 30 days
      );
      
      await tx.wait();
      await loadUserData(contract, account);
      setLoading(false);
    } catch (error) {
      console.error('Error creating premium drip:', error);
      setLoading(false);
    }
  };

  const contributeToFunding = async (requestId, amount) => {
    if (!contract) return;
    
    try {
      setLoading(true);
      const tx = await contract.contributeToFunding(
        requestId,
        ethers.utils.parseEther(amount)
      );
      
      await tx.wait();
      await loadUserData(contract, account);
      setLoading(false);
    } catch (error) {
      console.error('Error contributing:', error);
      setLoading(false);
    }
  };

  const Dashboard = () => {
    if (isAuthenticated && user) {
      return <PatientDashboard user={user} token={token} />;
    }
    
    return (
      <div className="dashboard">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="stat-content">
              <h3>Active Premium Drips</h3>
              <p className="stat-number">{premiumDrips.length}</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <DollarSign className="w-6 h-6" />
            </div>
            <div className="stat-content">
              <h3>Monthly Premium</h3>
              <p className="stat-number">$500</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <Calendar className="w-6 h-6" />
            </div>
            <div className="stat-content">
              <h3>Next Payment</h3>
              <p className="stat-number">Dec 15, 2024</p>
            </div>
          </div>
          
          <div className="stat-card">
            <div className="stat-icon">
              <Shield className="w-6 h-6" />
            </div>
            <div className="stat-content">
              <h3>Coverage Status</h3>
              <p className="stat-number active">Active</p>
            </div>
          </div>
        </div>

        <div className="action-section">
          <button onClick={createPremiumDrip} disabled={loading} className="btn-primary">
            <CreditCard className="w-4 h-4 mr-2" />
            {loading ? 'Creating...' : 'Create Premium Drip'}
          </button>
        </div>
      </div>
    );
  };

  const FundingRequests = () => (
    <div className="funding-requests">
      <h2>Community Funding Requests</h2>
      <div className="requests-grid">
        {fundingRequests.map((requestId, index) => (
          <div key={index} className="request-card">
            <div className="request-header">
              <h3>Emergency Surgery Fund</h3>
              <span className="request-status">Active</span>
            </div>
            <div className="request-body">
              <p>Patient needs funding for critical medical procedure</p>
              <div className="request-amount">
                <DollarSign className="w-4 h-4" />
                <span>2,500</span>
              </div>
            </div>
            <div className="request-actions">
              <button 
                onClick={() => contributeToFunding(requestId, '0.1')}
                disabled={loading}
                className="btn-secondary"
              >
                <Heart className="w-4 h-4 mr-2" />
                Contribute 0.1 ETH
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const Contributors = () => (
    <div className="contributors">
      <h2>Contributor Community</h2>
      <div className="contributors-grid">
        <div className="contributor-card">
          <div className="contributor-avatar">
            <UserPlus className="w-8 h-8" />
          </div>
          <div className="contributor-info">
            <h3>Dr. Sarah Chen</h3>
            <p>Cardiologist • Reputation: 850</p>
            <div className="contributor-stats">
              <span><Award className="w-4 h-4" /> 45 Reviews</span>
              <span><DollarSign className="w-4 h-4" /> 12.5 ETH Contributed</span>
            </div>
          </div>
        </div>
        
        <div className="contributor-card">
          <div className="contributor-avatar">
            <UserPlus className="w-8 h-8" />
          </div>
          <div className="contributor-info">
            <h3>Dr. Michael Ross</h3>
            <p>Neurologist • Reputation: 720</p>
            <div className="contributor-stats">
              <span><Award className="w-4 h-4" /> 32 Reviews</span>
              <span><DollarSign className="w-4 h-4" /> 8.3 ETH Contributed</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="logo">
            <Heart className="w-8 h-8" />
            <h1>Healthcare Drips</h1>
          </div>
          
          <nav className="header-nav">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={activeTab === 'dashboard' ? 'active' : ''}
            >
              <Activity className="w-4 h-4" />
              Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('funding')}
              className={activeTab === 'funding' ? 'active' : ''}
            >
              <Users className="w-4 h-4" />
              Funding
            </button>
            <button 
              onClick={() => setActiveTab('contributors')}
              className={activeTab === 'contributors' ? 'active' : ''}
            >
              <Award className="w-4 h-4" />
              Contributors
            </button>
            <button 
              onClick={() => setActiveTab('records')}
              className={activeTab === 'records' ? 'active' : ''}
            >
              <Database className="w-4 h-4" />
              Records
            </button>
            <button 
              onClick={() => setActiveTab('security')}
              className={activeTab === 'security' ? 'active' : ''}
            >
              <Lock className="w-4 h-4" />
              Security
            </button>
            <button 
              onClick={() => setActiveTab('engine')}
              className={activeTab === 'engine' ? 'active' : ''}
            >
              <Cpu className="w-4 h-4" />
              Engine
            </button>
            <button 
              onClick={() => setActiveTab('payments')}
              className={activeTab === 'payments' ? 'active' : ''}
            >
              <CreditIcon className="w-4 h-4" />
              Payments
            </button>
          </nav>
          
          <div className="wallet-section">
            {account ? (
              <div className="wallet-connected">
                <CheckCircle className="w-4 h-4" />
                <span>{account.slice(0, 6)}...{account.slice(-4)}</span>
              </div>
            ) : (
              <button onClick={connectWallet} className="btn-connect">
                <Shield className="w-4 h-4 mr-2" />
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {!account ? (
          <div className="connect-prompt">
            <AlertCircle className="w-12 h-12" />
            <h2>Connect Your Wallet</h2>
            <p>Please connect your MetaMask wallet to access the Healthcare Drips platform</p>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'funding' && <FundingRequests />}
            {activeTab === 'contributors' && <Contributors />}
            {activeTab === 'records' && <MedicalRecordManager account={account} contract={contract} />}
            {activeTab === 'security' && <MFASystem account={account} contract={contract} />}
            {activeTab === 'engine' && <ClaimEngine account={account} contract={contract} />}
            {activeTab === 'payments' && <PaymentGateways account={account} contract={contract} />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
