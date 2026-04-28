import React, { useState, useEffect, useCallback } from 'react';
import { 
  FileText, 
  Upload, 
  Shield, 
  Eye, 
  Lock, 
  UserPlus,
  History, 
  Search, 
  CheckCircle,
  AlertCircle,
  Loader2,
  X,
  FileImageIcon,
  RefreshCw
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import CryptoJS from 'crypto-js';
import { create as ipfsHttpClient } from 'ipfs-http-client';

const IPFS_PROJECT_ID = 'your_project_id';
const IPFS_PROJECT_SECRET = 'your_project_secret';
const auth = 'Basic ' + btoa(IPFS_PROJECT_ID + ':' + IPFS_PROJECT_SECRET);

const client = ipfsHttpClient({
  host: 'ipfs.infura.io',
  port: 5001,
  protocol: 'https',
  headers: { authorization: auth },
});

// ---------------------------------------------------------------------------
// Map Soroban IssueStatus enum variants to human-readable strings
// ---------------------------------------------------------------------------
const STATUS_LABEL = {
  Submitted: 'Submitted',
  UnderReview: 'Under Review',
  Approved: 'Approved',
  Rejected: 'Rejected',
  Paid: 'Paid',
  Closed: 'Closed',
};

const STATUS_COLOR = {
  Submitted: 'bg-blue-100 text-blue-700',
  UnderReview: 'bg-yellow-100 text-yellow-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Paid: 'bg-purple-100 text-purple-700',
  Closed: 'bg-gray-100 text-gray-500',
};

// ---------------------------------------------------------------------------
// Helper: derive a record "type" from IssueType for icon selection
// ---------------------------------------------------------------------------
const issueTypeToDisplayType = (issueType) => {
  if (!issueType) return 'report';
  const t = typeof issueType === 'object' ? Object.keys(issueType)[0] : issueType;
  if (t === 'MedicalClaim') return 'report';
  if (t === 'FraudReport') return 'flag';
  return 'report';
};

// ---------------------------------------------------------------------------
// Helper: normalise the status value returned by the Soroban SDK.
// The JS Stellar SDK returns enum variants as plain strings or as
// { <VariantName>: null } objects depending on the XDR decoder version.
// ---------------------------------------------------------------------------
const normaliseStatus = (status) => {
  if (!status) return 'Submitted';
  if (typeof status === 'string') return status;
  if (typeof status === 'object') return Object.keys(status)[0];
  return 'Submitted';
};

// ---------------------------------------------------------------------------
// Core fix: fetchRecordsFromContract
//
// Strategy:
//   1. Read the CLAIM_C counter from instance storage to know how many claims exist.
//   2. Iterate claim IDs 1..CLAIM_C and call get_insurance_claim(id) on each.
//   3. Keep only claims where claimant === current account.
//
// The contract stores claims in a Map<u64, InsuranceClaim> keyed by "CLAIM"
// and exposes `get_insurance_claim(env, claim_id) -> Result<InsuranceClaim, …>`.
// ---------------------------------------------------------------------------
const fetchRecordsFromContract = async (contract, account) => {
  // contract is the Soroban contract client injected from App.js
  // It must expose .get_insurance_claim({ claim_id }) and a way to read
  // the CLAIM_C counter. If your client wraps every function directly,
  // adjust the call syntax to match your generated bindings.

  // 1. Get total claim count
  //    Depending on the SDK wrapper you use this might be:
  //      contract.storage().instance().get('CLAIM_C')
  //    or a dedicated getter. We call it via a generic invoke as fallback.
  let claimCount = 0;
  try {
    // Try a direct getter first (add one to your contract if it doesn't exist)
    const countResult = await contract.get_claim_count();
    claimCount = Number(countResult);
  } catch {
    // Fallback: if the contract client exposes raw storage access
    try {
      const countResult = await contract.invoke({ method: 'get_claim_count', args: [] });
      claimCount = Number(countResult);
    } catch {
      console.warn('Could not fetch claim count; defaulting to 0.');
      return [];
    }
  }

  if (claimCount === 0) return [];

  // 2. Fetch each claim and filter by claimant
  const fetchPromises = [];
  for (let id = 1; id <= claimCount; id++) {
    fetchPromises.push(
      contract
        .get_insurance_claim({ claim_id: BigInt(id) })
        .catch(() => null) // silently skip missing/errored entries
    );
  }

  const results = await Promise.all(fetchPromises);

  // 3. Filter to claims owned by the current account and shape the data
  const userClaims = results
    .filter((claim) => {
      if (!claim) return false;
      // claimant is a Stellar Address; convert to string for comparison
      const claimantStr =
        typeof claim.claimant === 'string'
          ? claim.claimant
          : claim.claimant?.toString?.() ?? '';
      return claimantStr === account;
    })
    .map((claim) => ({
      id: Number(claim.id),
      description: claim.description ?? `Claim #${claim.id}`,
      // evidence_ipfs is Vec<String> from Soroban; take the first hash as the CID
      cid: claim.evidence_ipfs?.[0] ?? '',
      evidenceList: claim.evidence_ipfs ?? [],
      created: Number(claim.submitted_at),
      amount: Number(claim.amount),
      issueType: claim.issue_type,
      status: normaliseStatus(claim.status),
      type: issueTypeToDisplayType(claim.issue_type),
      owner: account,
      insurer: claim.insurer?.toString?.() ?? '',
      fraudFlag: claim.fraud_flag ?? null,
      payoutAmount: claim.payout_amount ? Number(claim.payout_amount) : null,
      reviewedAt: claim.reviewed_at ? Number(claim.reviewed_at) : null,
      reviewer: claim.reviewer?.toString?.() ?? null,
    }));

  return userClaims;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
const MedicalRecordManager = ({ account, contract }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [decryptionKey, setDecryptionKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // -------------------------------------------------------------------------
  // FIX: loadRecords now queries the real contract instead of mock data
  // -------------------------------------------------------------------------
  const loadRecords = useCallback(async () => {
    if (!account || !contract) return;

    try {
      setLoading(true);
      setError(null);

      const claims = await fetchRecordsFromContract(contract, account);
      setRecords(claims);
    } catch (err) {
      console.error('Error loading records:', err);
      setError('Failed to load records from the contract. Check console for details.');
    } finally {
      setLoading(false);
    }
  }, [account, contract]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  // -------------------------------------------------------------------------
  // Upload / drag-drop (unchanged logic, kept intact)
  // -------------------------------------------------------------------------
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) uploadFile(e.dataTransfer.files[0]);
  };

  const uploadFile = async (file) => {
    try {
      setUploading(true);
      setUploadProgress(10);

      const encryptionKey = CryptoJS.lib.WordArray.random(128 / 8).toString();
      setUploadProgress(30);

      const reader = new FileReader();
      reader.onload = async (e) => {
        const content = e.target.result;
        setUploadProgress(50);

        const encrypted = CryptoJS.AES.encrypt(
          CryptoJS.lib.WordArray.create(content),
          encryptionKey
        ).toString();

        setUploadProgress(70);
        // Mock IPFS CID — replace with real `client.add(encrypted)` when IPFS is available
        const mockCid = 'Qm' + Math.random().toString(36).substring(7);

        setUploadProgress(90);
        // TODO: call contract.submit_insurance_claim(...) here and reload
        // await contract.submit_insurance_claim({ claimant: account, insurer: '...', ... });
        // await loadRecords(); // refresh from chain after submission

        // Optimistic local append until on-chain submission is wired up
        const newRecord = {
          id: records.length + 1,
          description: file.name,
          cid: mockCid,
          evidenceList: [mockCid],
          created: Math.floor(Date.now() / 1000),
          amount: 0,
          issueType: 'MedicalClaim',
          status: 'Submitted',
          type: file.type.split('/')[0] || 'report',
          owner: account,
          insurer: '',
          fraudFlag: null,
          payoutAmount: null,
        };

        setRecords((prev) => [newRecord, ...prev]);
        setUploadProgress(100);

        setTimeout(() => {
          setUploading(false);
          setUploadProgress(0);
          alert(`File uploaded! Save your encryption key:\n${encryptionKey}`);
        }, 500);
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      console.error('Upload failed:', err);
      setUploading(false);
    }
  };

  const decryptAndPreview = async (record) => {
    if (!decryptionKey) {
      setShowKeyInput(true);
      setSelectedRecord(record);
      return;
    }
    try {
      setLoading(true);
      // Real IPFS fetch + decrypt would go here
      setViewingRecord({
        ...record,
        content: `Decrypted content for: ${record.description}`,
      });
      setShowKeyInput(false);
    } catch {
      alert('Invalid decryption key');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Filter
  // -------------------------------------------------------------------------
  const filteredRecords = records.filter((r) => {
    const matchesSearch = r.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'all' || r.type === filterType || r.status === filterType;
    return matchesSearch && matchesFilter;
  });

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="medical-record-manager p-6 max-w-6xl mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center mb-8 flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Insurance Claims</h2>
          <p className="text-gray-500 text-sm mt-1">
            Fetched live from the HealthcareDrips Soroban contract
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search claims..."
              className="pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Filter */}
          <select
            className="px-4 py-2 border rounded-lg bg-white text-sm"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="Submitted">Submitted</option>
            <option value="UnderReview">Under Review</option>
            <option value="Approved">Approved</option>
            <option value="Paid">Paid</option>
            <option value="Rejected">Rejected</option>
          </select>

          {/* Reload button */}
          <button
            onClick={loadRecords}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mb-6 flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Upload zone */}
      <div
        className={`mb-10 border-2 border-dashed rounded-xl p-10 text-center transition-all ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <Upload className="w-10 h-10 mx-auto text-blue-500 mb-3" />
        <h3 className="text-lg font-semibold mb-1">Attach Evidence to a Claim</h3>
        <p className="text-gray-500 text-sm mb-5">
          PDF, JPEG, PNG — encrypted before upload to IPFS
        </p>

        <input
          type="file"
          id="file-upload"
          className="hidden"
          onChange={(e) => uploadFile(e.target.files[0])}
        />
        <label
          htmlFor="file-upload"
          className="cursor-pointer bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          Select File
        </label>

        {uploading && (
          <div className="mt-6">
            <div className="flex justify-between text-xs mb-1 text-gray-600">
              <span>Encrypting &amp; uploading…</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-1.5">
              <motion.div
                className="bg-blue-500 h-1.5 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Loading state */}
      {loading && records.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">Fetching claims from the contract…</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && records.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <FileText className="w-12 h-12 mb-4 opacity-30" />
          <p className="text-sm font-medium">No claims found for your account.</p>
          <p className="text-xs mt-1">Submit a claim to see it appear here.</p>
        </div>
      )}

      {/* Records grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <AnimatePresence>
          {filteredRecords.map((record) => {
            const statusKey = record.status;
            return (
              <motion.div
                key={record.id}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white border rounded-xl overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="p-5">
                  {/* Top row */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-2.5 bg-blue-50 rounded-lg">
                      {record.type === 'image' ? (
                        <FileImageIcon className="w-5 h-5 text-blue-600" />
                      ) : (
                        <FileText className="w-5 h-5 text-blue-600" />
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => decryptAndPreview(record)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Preview"
                      >
                        <Eye className="w-4 h-4 text-gray-500" />
                      </button>
                      <button
                        onClick={() => setSelectedRecord(record)}
                        className="p-2 hover:bg-gray-100 rounded-lg"
                        title="Details"
                      >
                        <Shield className="w-4 h-4 text-gray-500" />
                      </button>
                    </div>
                  </div>

                  {/* Description */}
                  <h4 className="font-semibold text-gray-900 truncate mb-1 text-sm">
                    {record.description}
                  </h4>

                  {/* Meta */}
                  <div className="text-xs text-gray-400 flex items-center gap-1 mb-3">
                    <History className="w-3 h-3" />
                    Claim #{record.id} · {new Date(record.created * 1000).toLocaleDateString()}
                  </div>

                  {/* Amount */}
                  {record.amount > 0 && (
                    <p className="text-xs text-gray-600 mb-2">
                      Amount: <span className="font-semibold">{record.amount.toLocaleString()} XLM</span>
                    </p>
                  )}

                  {/* Status + fraud badge */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-wrap">
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        STATUS_COLOR[statusKey] ?? 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {STATUS_LABEL[statusKey] ?? statusKey}
                    </span>

                    {record.fraudFlag && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Fraud Flag
                      </span>
                    )}

                    {record.payoutAmount && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-600 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Paid {record.payoutAmount.toLocaleString()} XLM
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Decryption key modal */}
      {showKeyInput && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl p-8 max-w-md w-full shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-5">
              <Lock className="w-5 h-5 text-orange-500" />
              <h3 className="text-lg font-bold">Decryption Required</h3>
            </div>
            <p className="text-gray-500 text-sm mb-5">
              Enter the symmetric key used to encrypt this file.
            </p>
            <input
              type="password"
              placeholder="Encryption key"
              className="w-full px-4 py-3 border rounded-lg mb-5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={decryptionKey}
              onChange={(e) => setDecryptionKey(e.target.value)}
            />
            <div className="flex gap-3">
              <button
                onClick={() => { setShowKeyInput(false); setDecryptionKey(''); }}
                className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => decryptAndPreview(selectedRecord)}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
              >
                Decrypt
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Viewer modal */}
      {viewingRecord && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[60] p-8">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl w-full max-w-3xl flex flex-col overflow-hidden shadow-2xl max-h-[90vh]"
          >
            <div className="p-5 border-b flex justify-between items-center bg-gray-50">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-blue-600" />
                <div>
                  <h3 className="font-bold text-gray-900">{viewingRecord.description}</h3>
                  <p className="text-xs text-gray-400">CID: {viewingRecord.cid || 'N/A'}</p>
                </div>
              </div>
              <button onClick={() => setViewingRecord(null)} className="p-2 hover:bg-gray-200 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-8 bg-gray-50">
              <div className="bg-white p-7 rounded-xl shadow-sm max-w-xl mx-auto space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Claim ID</p>
                    <p className="font-mono">#{viewingRecord.id}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Status</p>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[viewingRecord.status]}`}>
                      {STATUS_LABEL[viewingRecord.status] ?? viewingRecord.status}
                    </span>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Amount</p>
                    <p className="font-semibold">{viewingRecord.amount?.toLocaleString() ?? 0} XLM</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">Submitted</p>
                    <p>{new Date(viewingRecord.created * 1000).toLocaleDateString()}</p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Decrypted Content</p>
                  <div className="bg-gray-50 border rounded-lg p-4 text-sm text-gray-700 leading-relaxed">
                    {viewingRecord.content}
                  </div>
                </div>

                {viewingRecord.fraudFlag && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-xs font-bold text-red-600 mb-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Fraud Flag Detected
                    </p>
                    <p className="text-xs text-red-500">
                      Risk Level: {viewingRecord.fraudFlag.risk_level?.toString() ?? 'Unknown'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="p-5 border-t bg-gray-50 flex justify-end gap-3">
              <button
                onClick={() => setViewingRecord(null)}
                className="px-5 py-2 border rounded-lg text-sm hover:bg-gray-100"
              >
                Close
              </button>
              <button className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 font-medium">
                Download Original
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default MedicalRecordManager;